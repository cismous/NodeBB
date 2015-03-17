'use strict';

var async = require('async'),

    db = require('../database'),
    votes = require('../votes'),
    user = require('../user'),
    helpers = require('./helpers'),
    groups = require('../groups'),
    categories = require('../categories'),
    plugins = require('../plugins');

module.exports = function(privileges) {
    privileges.votes = {};

    privileges.votes.get = function(vid, uid, callback) {
        callback();
    }
};
