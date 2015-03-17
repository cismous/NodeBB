
'use strict';

var async = require('async'),
	winston = require('winston'),

	db = require('../database'),
	user = require('../user'),
	meta = require('../meta'),
	notifications = require('../notifications'),
	categories = require('../categories'),
	privileges = require('../privileges');

module.exports = function(Votes) {

	Votes.getTotalUnread = function(uid, callback) {
		Votes.getUnreadTids(uid, 0, 20, function(err, vids) {
			callback(err, vids ? vids.length : 0);
		});
	};

	Votes.getUnreadVotes = function(uid, start, stop, callback) {

		var unreadVotes = {
			showSelect: true,
			nextStart : 0,
			votes: []
		};

		async.waterfall([
			function(next) {
				Votes.getUnreadTids(uid, start, stop, next);
			},
			function(vids, next) {
				if (!vids.length) {
					return next(null, []);
				}
				Votes.getVotesByTids(vids, uid, next);
			},
			function(voteData, next) {
				if (!Array.isArray(voteData) || !voteData.length) {
					return next(null, unreadVotes);
				}

				unreadVotes.votes = voteData;
				unreadVotes.nextStart = stop + 1;
				next(null, unreadVotes);
			}
		], callback);
	};

	Votes.getUnreadTids = function(uid, start, stop, callback) {
		uid = parseInt(uid, 10);
		if (uid === 0) {
			return callback(null, []);
		}

		var yesterday = Date.now() - 86400000;

		async.parallel({
			ignoredCids: function(next) {
				user.getIgnoredCategories(uid, next);
			},
			recentTids: function(next) {
				db.getSortedSetRevRangeByScoreWithScores('votes:recent', 0, -1, '+inf', yesterday, next);
			},
			userScores: function(next) {
				db.getSortedSetRevRangeByScoreWithScores('uid:' + uid + ':vids_read', 0, -1, '+inf', yesterday, next);
			}
		}, function(err, results) {
			if (err) {
				return callback(err);
			}

			if (results.recentTids && !results.recentTids.length) {
				return callback(null, []);
			}

			var userRead = {};
			results.userScores.forEach(function(userItem) {
				userRead[userItem.value] = userItem.score;
			});


			var vids = results.recentTids.filter(function(recentVote, index) {
				return !userRead[recentVote.value] || recentVote.score > userRead[recentVote.value];
			}).map(function(vote) {
				return vote.value;
			});

			vids = vids.slice(0, 100);

			filterVotes(uid, vids, results.ignoredCids, function(err, vids) {
				if (err) {
					return callback(err);
				}

				if (stop === -1) {
					vids = vids.slice(start);
				} else {
					vids = vids.slice(start, stop + 1);
				}

				callback(null, vids);
			});
		});
	};

	function filterVotes(uid, vids, ignoredCids, callback) {
		if (!Array.isArray(ignoredCids) || !vids.length) {
			return callback(null, vids);
		}

		async.waterfall([
			function(next) {
				privileges.votes.filter('read', vids, uid, next);
			},
			function(vids, next) {
				Votes.getVotesFields(vids, ['vid', 'cid'], next);
			},
			function(votes, next) {
				vids = votes.filter(function(vote) {
					return vote && vote.cid && ignoredCids.indexOf(vote.cid.toString()) === -1;
				}).map(function(vote) {
					return vote.vid;
				});
				next(null, vids);
			}
		], callback);
	}

	Votes.pushUnreadCount = function(uid, callback) {
		callback = callback || function() {};

		if (!uid || parseInt(uid, 10) === 0) {
			return callback();
		}
		Votes.getTotalUnread(uid, function(err, count) {
			if (err) {
				return callback(err);
			}
			require('../socket.io').in('uid_' + uid).emit('event:unread.updateCount', null, count);
			callback();
		});
	};

	Votes.markAsUnreadForAll = function(vid, callback) {
		Votes.markCategoryUnreadForAll(vid, callback);
	};

	Votes.markAsRead = function(vids, uid, callback) {
		callback = callback || function() {};
		if (!Array.isArray(vids) || !vids.length) {
			return callback();
		}
		vids = vids.filter(Boolean);
		if (!vids.length) {
			return callback();
		}

		async.parallel({
			voteScores: function(next) {
				db.sortedSetScores('votes:recent', vids, next);
			},
			userScores: function(next) {
				db.sortedSetScores('uid:' + uid + ':vids_read', vids, next);
			}
		}, function(err, results) {
			if (err) {
				return callback(err);
			}

			vids = vids.filter(function(vid, index) {
				return !results.userScores[index] || results.userScores[index] < results.voteScores[index];
			});

			if (!vids.length) {
				return callback();
			}

			var now = Date.now();
			var scores = vids.map(function(vid) {
				return now;
			});

			async.parallel({
				markRead: function(next) {
					db.sortedSetAdd('uid:' + uid + ':vids_read', scores, vids, next);
				},
				voteData: function(next) {
					Votes.getVotesFields(vids, ['cid'], next);
				}
			}, function(err, results) {
				if (err) {
					return callback(err);
				}

				var cids = results.voteData.map(function(vote) {
					return vote && vote.cid;
				}).filter(function(vote, index, array) {
					return vote && array.indexOf(vote) === index;
				});

				categories.markAsRead(cids, uid, callback);
			});
		});
	};

	Votes.markVoteNotificationsRead = function(vid, uid) {
		if (!vid) {
			return;
		}
		user.notifications.getUnreadByField(uid, 'vid', vid, function(err, nids) {
			if (err) {
				return winston.error(err.stack);
			}
			notifications.markReadMultiple(nids, uid, function() {
				user.notifications.pushCount(uid);
			});
		});
	};

	Votes.markCategoryUnreadForAll = function(vid, callback) {
		Votes.getVoteField(vid, 'cid', function(err, cid) {
			if(err) {
				return callback(err);
			}

			categories.markAsUnreadForAll(cid, callback);
		});
	};

	Votes.hasReadVotes = function(vids, uid, callback) {
		if(!parseInt(uid, 10)) {
			return callback(null, vids.map(function() {
				return false;
			}));
		}

		async.parallel({
			recentScores: function(next) {
				db.sortedSetScores('votes:recent', vids, next);
			},
			userScores: function(next) {
				db.sortedSetScores('uid:' + uid + ':vids_read', vids, next);
			}
		}, function(err, results) {
			if (err) {
				return callback(err);
			}
			var result = vids.map(function(vid, index) {
				return !!(results.userScores[index] && results.userScores[index] >= results.recentScores[index]);
			});

			callback(null, result);
		});
	};

	Votes.hasReadVote = function(vid, uid, callback) {
		Votes.hasReadVotes([vid], uid, function(err, hasRead) {
			callback(err, Array.isArray(hasRead) && hasRead.length ? hasRead[0] : false);
		});
	};


};
