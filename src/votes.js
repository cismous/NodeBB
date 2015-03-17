"use strict";

var async = require('async'),
    validator = require('validator'),

    _ = require('underscore'),
    db = require('./database'),
    posts = require('./posts'),
    utils = require('../public/src/utils'),
    plugins = require('./plugins'),
    user = require('./user'),
    categories = require('./categories'),
    privileges = require('./privileges');

(function (Votes) {
    require('./votes/create')(Votes);
    require('./votes/unread')(Votes);
    require('./votes/recent')(Votes);
    require('./votes/teaser')(Votes);
    require('./votes/posts')(Votes);

    Votes.exists = function (vid, callback) {
        db.isSortedSetMember('votes:vid', vid, callback);
    };

    Votes.getVoteField = function (vid, field, callback) {
        db.getObjectField('vote:' + vid, field, callback);
    };

    Votes.getVoteFields = function (vid, fields, callback) {
        db.getObjectFields('vote:' + vid, fields, callback);
    };

    Votes.isLocked = function (vid, callback) {
        Votes.getVoteField(vid, 'locked', function (err, locked) {
            callback(err, parseInt(locked, 10) === 1);
        });
    };

    Votes.getVoteData = function (vid, callback) {
        db.getObject('vote:' + vid, function (err, vote) {
            if (err || !vote) {
                return callback(err);
            }
            modifyVote(vote, callback);
        });
    };

    Votes.getVotesData = function (vids, callback) {
        var keys = [];

        for (var i = 0; i < vids.length; ++i) {
            keys.push('vote:' + vids[i]);
        }

        db.getObjects(keys, function (err, votes) {
            if (err) {
                return callback(err);
            }
            async.map(votes, modifyVote, callback);
        });
    };

    Votes.getVotesByVids = function (vids, uid, callback) {
        if (!Array.isArray(vids) || !vids.length) {
            return callback(null, []);
        }

        Votes.getVotesData(vids, function (err, votes) {
            function mapFilter(array, field) {
                return array.map(function (vote) {
                    return vote && vote[field] && vote[field].toString();
                }).filter(function (value, index, array) {
                    return utils.isNumber(value) && array.indexOf(value) === index;
                });
            }

            if (err) {
                return callback(err);
            }

            var uids = mapFilter(votes, 'uid');
            var cids = mapFilter(votes, 'cid');

            async.parallel({
                teasers: function (next) {
                    Votes.getTeasers(votes, next);
                },
                users: function (next) {
                    user.getMultipleUserFields(uids, ['uid', 'username', 'userslug', 'picture'], next);
                },
                categories: function (next) {
                    categories.getMultipleCategoryFields(cids, ['cid', 'name', 'slug', 'icon', 'bgColor', 'color', 'disabled'], next);
                },
                hasRead: function (next) {
                    Votes.hasReadVotes(vids, uid, next);
                }
            }, function (err, results) {
                if (err) {
                    return callback(err);
                }

                var users = _.object(uids, results.users);
                var categories = _.object(cids, results.categories);

                for (var i = 0; i < votes.length; ++i) {
                    if (votes[i]) {
                        votes[i].category = categories[votes[i].cid];
                        votes[i].user = users[votes[i].uid];
                        votes[i].teaser = results.teasers[i];

                        votes[i].isOwner = parseInt(votes[i].uid, 10) === parseInt(uid, 10);
                        votes[i].pinned = parseInt(votes[i].pinned, 10) === 1;
                        votes[i].locked = parseInt(votes[i].locked, 10) === 1;
                        votes[i].deleted = parseInt(votes[i].deleted, 10) === 1;
                        votes[i].unread = !results.hasRead[i];
                        votes[i].unreplied = parseInt(votes[i].postcount, 10) <= 1;
                    }
                }

                plugins.fireHook('filter:votes.get', {votes: votes, uid: uid}, function (err, voteData) {
                    callback(err, voteData.votes);
                });
            });
        });
    };

    Votes.getVoteWithPosts = function(vid, set, uid, start, end, reverse, callback) {
        Votes.getVoteData(vid, function(err, voteData) {
            if (err || !voteData) {
                return callback(err || new Error('[[error:no-vote]]'));
            }

            async.parallel({
                mainPost: function(next) {
                    getMainPosts([voteData.mainPid], uid, next);
                },
                posts: function(next) {
                    Votes.getVotePosts(vid, set, start, end, uid, reverse, next);
                }
            }, function(err, results) {
                if (err) {
                    return callback(err);
                }

                voteData.posts = Array.isArray(results.mainPost) && results.mainPost.length ? [results.mainPost[0]].concat(results.posts) : results.posts;

                voteData.unreplied = parseInt(voteData.postcount, 10) === 1;
                voteData.deleted = parseInt(voteData.deleted, 10) === 1;
                voteData.locked = parseInt(voteData.locked, 10) === 1;
                voteData.pinned = parseInt(voteData.pinned, 10) === 1;

                plugins.fireHook('filter:vote.get', voteData, callback);
            });
        });
    };

    Votes.getMainPost = function(tid, uid, callback) {
        Votes.getMainPosts([tid], uid, function(err, mainPosts) {
            callback(err, Array.isArray(mainPosts) && mainPosts.length ? mainPosts[0] : null);
        });
    };

    Votes.getMainPosts = function(tids, uid, callback) {
        Votes.getVotesFields(tids, ['mainVid'], function(err, voteData) {
            if (err) {
                return callback(err);
            }

            var mainPids = voteData.map(function(vote) {
                return vote ? vote.mainVid : null;
            });

            getMainPosts(mainPids, uid, callback);
        });
    };

    function getMainPosts(mainPids, uid, callback) {
        posts.getPostsByPids(mainPids, uid, function(err, postData) {
            if (err) {
                return callback(err);
            }
            postData.forEach(function(post) {
                if (post) {
                    post.index = 0;
                }
            });
            Votes.addPostData(postData, uid, callback);
        });
    }

    function modifyVote(vote, callback) {
        if (!vote) {
            return callback(null, vote);
        }
        vote.title = validator.escape(vote.title);
        vote.relativeTime = utils.toISOString(vote.timestamp);
        callback(null, vote);
    }

    Votes.setVoteField = function(vid, field, value, callback) {
        db.setObjectField('vote:' + vid, field, value, callback);
    };
}(exports));
