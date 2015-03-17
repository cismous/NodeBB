"use strict";

var async = require('async'),
    winston = require('winston'),
    db = require('../database');

module.exports = function (Votes) {
    Votes.updateTimestamp = function (vid, timestamp, callback) {
        async.parallel([
            function(next) {
                Votes.updateRecent(vid, timestamp, next)
            },
            function(next) {
                Votes.setVoteField(vid, 'lastposttime', timestamp ,next)
            }
        ], callback)
    };

    Votes.updateRecent = function (vid, timestamp, callback) {
        callback = callback || function() {};
        db.sortedSetAdd('votes:recent', timestamp, vid, callback);
    }
};