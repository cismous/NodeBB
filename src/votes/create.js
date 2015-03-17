"use strict";

var async = require('async'),
    validator = require('validator'),
    db = require('../database'),
    utils = require('../../public/src/utils'),
    plugins = require('../plugins'),
    user = require('../user'),
    meta = require('../meta'),
    posts = require('../posts'),
    threadTools = require('../threadTools'),
    postTools = require('../postTools'),
    privileges = require('../privileges');

module.exports = function (Votes) {
    Votes.create = function (data, callback) {
        var uid = data.uid,
            email = data.email,
            username = data.username,
            vid = data.vid;

        db.incrObjectField('global', 'nextVid', function (err, vid) {
            if (err) {
                return callback(err);
            }

            var slug = utils.slugify(username),
                timestamp = Date.now();

            if (!slug.length) {
                return callback(new Error('[[error:invalid-username]]'));
            }

            slug = vid + '/' + slug;

            var voteData = {
                'vid': vid,
                'uid': uid,
                'mainPid': 0,
                'voteUid': [uid],
                'slug': slug,
                'email': email,
                'username': username,
                'joined': false,
                'invited': false,
                'timestamp': timestamp,
                'lastposttime': 0,
                'postcount': 0,
                'viewcount': 0,
                'locked': 0,
                'deleted': 0,
                'pinned': 0
            };

            db.setObject('vote:' + vid, voteData, function (err) {
                if (err) {
                    return callback(err);
                }

                async.parallel([
                    function (next) {
                        db.sortedSetsAdd([
                            'votes:vid',
                            'vid:' + vid + ':vids',
                            'vid:' + vid + ':uid:' + uid + ':vids'
                        ], timestamp, vid, next);
                    },
                    function (next) {
                        db.incrObjectField('global', 'voteCount', next);
                    }
                ], function (err) {
                    if (err) {
                        return callback(err);
                    }
                    callback(null, vid);
                });
            });
        });
    };

    Votes.post = function (data, callback) {
        var uid = data.uid,
            handle = data.handle,
            content = data.content,
            email = data.email,
            username = data.username;

        async.waterfall([
            function (next) {
                checkContentLength(content, next);
            },
            function (next) {
                Votes.create({uid: uid, email: email, username: username}, next);
            },
            function (vid, next) {
                Votes.reply({uid: uid, vid: vid, email: email, username: username, handle: handle, content: content}, next);
            },
            function(postData, next) {
                async.parallel({
                    postData: function(next) {
                        next(null, postData);
                    },
                    settings: function(next) {
                        user.getSettings(uid, function(err, settings) {
                            if (err) {
                                return next(err);
                            }
                            if (settings.followVotesOnCreate) {
                                Votes.follow(postData.tid, uid, next);
                            } else {
                                next();
                            }
                        });
                    },
                    voteData: function(next) {
                        Votes.getVotesByVids([postData.vid], uid, next);
                    }
                }, next);
            },
            function (data, next) {
                if(!Array.isArray(data.voteData) || !data.voteData.length) {
                    return next(new Error('[[error:no-vote]]'));
                }

                data.voteData = data.voteData[0];
                data.voteData.unreplied = 1;

                //if (parseInt(uid, 10)) {
                //    user.notifications.sendVoteNotificationToFollowers(uid, data.voteData, data.postData);
                //}

                next(null, {
                    voteData: data.voteData,
                    postData: data.postData
                });
            }
        ], callback);
    };

    Votes.reply = function (data, callback) {
        var vid = data.vid,
            uid = data.uid,
            voteUid = [data.uid],
            toPid = data.toPid,
            handle = data.handle,
            content = data.content,
            postData;

        async.waterfall([
            function (next) {
                async.parallel({
                    exist: function (next) {
                        Votes.exists(vid, next);
                    },
                    locked: function (next) {
                        Votes.isLocked(vid, next);
                    }
                }, next)
            },
            function (results, next) {
                //if (!results.exists) {
                //    return next(new Error('[[error:no-vote]]'));
                //}
                if (results.locked) {
                    return next(new Error('[[error:vote-locked]]'));
                }
                return next(null);
            },
            function (next) {
                posts.create({uid: uid, vid: vid, voteUid: voteUid, handle: handle, content: content, toPid: toPid, ip: data.req ? data.req.ip : null}, next);
            },
            function(data, next) {
                postData = data;
                //Votes.markAsUnreadForAll(vid, next);
                next();
            },
            function(next) {
                //Votes.markAsRead([vid], uid, next);
                next();
            },
            function(next) {
                async.parallel({
                    userInfo: function(next) {
                        posts.getUserInfoForPosts([postData.uid], uid, next);
                    },
                    voteInfo: function(next) {
                        Votes.getVoteFields(vid, ['vid', 'username', 'slug'], next);
                    },
                    settings: function(next) {
                        user.getSettings(uid, next);
                    },
                    postIndex: function(next) {
                        posts.getVidIndex(postData.vid, uid, next);
                    },
                    content: function(next) {
                        postTools.parsePost(postData, uid, next);
                    }
                }, next);
            },
            function(results, next) {
                postData.user = results.userInfo[0];
                postData.vote = results.voteInfo;

                // Username override for guests, if enabled
                if (parseInt(meta.config.allowGuestHandles, 10) === 1 && parseInt(postData.uid, 10) === 0 && data.handle) {
                    postData.user.username = data.handle;
                }

                if (results.settings.followTopicsOnReply) {
                    Votes.follow(postData.vid, uid);
                }
                postData.index = results.postIndex - 1;
                postData.favourited = false;
                postData.votes = 0;
                postData.display_moderator_tools = true;
                postData.display_move_tools = true;
                postData.selfPost = false;
                postData.relativeTime = utils.toISOString(postData.timestamp);

                //if (parseInt(uid, 10)) {
                //    Votes.notifyFollowers(postData, uid);
                //}

                next(null, postData);
            }
        ], callback)
    };

    function checkContentLength(content, callback) {
        if (!content || content.length < parseInt(meta.config.miminumPostLength, 10)) {
            return callback(new Error('[[error:content-too-short, ' + meta.config.minimumPostLength + ']]'));
        } else if (content.length > parseInt(meta.config.maximumPostLength, 10)) {
            return callback(new Error('[[error:content-too-long, ' + meta.config.maximumPostLength + ']]'));
        }
        callback();
    }
};
