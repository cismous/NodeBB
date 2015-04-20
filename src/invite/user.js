'use strict';

var db = require('../database'),
	nconf = require('nconf'),
	async = require('async'),
	meta = require('../meta'),
	utils = require('../../public/src/utils'),
	plugins = require('../plugins'),
	user = require('../user'),
	invite = require('../invite'),
	jobs = require('../schedule'),
	emailer = require('../emailer');

module.exports = function (Invite) {
	Invite.isOwner = function (iid, uid, callback) {
		uid = parseInt(uid, 10);
		if (!uid) {
			return callback(null, false);
		}
		Invite.getInviteField(iid, 'uid', function (err, author) {
			callback(err, parseInt(author, 10) === uid);
		});
	};

	Invite.emailExists = function(email, callback) {
		if (email) {
			async.waterfall([
				function (next) {
					user.email.exists(email, next);
				}
			], function (err, exists) {
				if (err) {
					return callback(err);
				}

				callback(null, exists);
			});
		}
	};

	Invite.usernameExists = function(username, callback) {
		if (username) {
			async.waterfall([
				function (next) {
					meta.userOrGroupExists(utils.slugify(username), next);
				}
			], function (err, exists) {
				if (err) {
					return callback(err);
				}

				callback(null, exists);
			})
		}
	};

	Invite.getIidByEmail = function(email, callback) {
		db.getObjectField('email:iid', email.toLowerCase(), callback);
	};

	Invite.getIidByUsername = function(username, callback) {
		db.getObjectField('username:iid:invite', username, callback);
	};

	Invite.inviteUser = function (uid, iid, voteCount, callback) {
		async.waterfall([
			function (next) {
				db.getObjectField('global', 'userCount', next);
			},
			function (userCount, next) {
				voteCount = parseInt(voteCount, 10);
				userCount = parseInt(userCount, 10);

				var votePercent = voteCount / userCount >= (meta.config.votePercent ? meta.config.votePercent/100 : 0.5);
				next(null, votePercent);
			},
			function (votePercent, next) {
				if (votePercent) {
					return db.getObjectFields('invite:' + iid, ['slug', 'username'], next);
				}
				callback();
			},
			function (inviteData, next) {
				user.notifications.sendNotification({
					bodyShort: '[[invite:notification.invited, ' + inviteData.username + ']]',
					path: nconf.get('relative_path') + '/invite/' + inviteData.slug,
					score: 'votedUids',
					uid: uid,
					iid: iid,
					nid: 'upvote:uid:' + uid + ':iid:' + iid
				}, next);
			},
			function (next) {
				Invite.sendUser(uid, iid, function (err) {
					if (err) {
						return next(err);
					}
					jobs.setWarn(iid, Date.now());
				});
			}
		], callback);
	};

	Invite.sendUser = function (uid, iid, callback) {
		var userData = {},
			register_code = utils.generateUUID(),
			register_link = nconf.get('url') + '/register?code=' + register_code,
			timestamp = Date.now();

		async.waterfall([
			function (next) {
				invite.getInviteFields(iid, ['username', 'uid', 'email'], next);
			},
			function (data, next) {
				userData = data;
				db.setObject('confirm:' + register_code, {
					email: data.email.toLowerCase(),
					username: data.username
				}, next);
			},
			function (next) {
				user.getUserFields(userData.uid, ['iid', 'username'], next);
			},
			function (data, next) {
				userData.from_username = data.username;
				if (data.iid) {
					invite.getInviteField(data.iid, 'username', next);
				} else {
					next(null, '管理员');
				}
			},
			function (username, next) {
				userData.from_invite_username = username;
				db.setObjectField('invite:' + iid, 'invited', 1, next);
			},
			function (next) {
				db.setObjectField('invite:' + iid, 'invitedTime', timestamp, next);
			},
			function(next) {
				// invite:time 记录邀请时间和iid 该表用于执行定时任务
				db.sortedSetAdd('invite:time', iid, timestamp, next);
			},
			function (next) {
				// 邀请链接默认7天到期
				db.expireAt('confirm:' + register_code, Math.floor(timestamp / parseInt(meta.config['invite:expireTime'], 10)), next);
			}
		], function (err) {
			if (err) {
				return callback(err);
			}

			// for test
			if ((userData.email.indexOf('yufeg.com') !== -1 || userData.email.indexOf('test') !== -1) && process.env.NODE_ENV === 'development') {
				console.log('development test');
				return callback();
			}

			var params = {
				email: userData.email,
				register_link: register_link,
				site_title: meta.config.title || 'NodeBB',
				username: userData.username,
				from_username: userData.from_username,
				uid: userData.uid,
				from_invite_username: userData.from_invite_username
			};
			if (plugins.hasListeners('action:email.send')) {
				emailer.sendInvite(params, callback);
			} else {
				callback(new Error('[[error:no-emailers-configured]]'));
			}
		});
	};
};
