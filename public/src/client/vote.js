"use strict";
/* global define, config, templates, app, utils, ajaxify, socket, translator */

define('forum/vote', [
    'composer',
    'navigator'
], function(composer, navigator) {
    var Vote = {},
        currentUrl = '';

    $(window).on('action:ajaxify.start', function(ev, data) {
        if(data.tpl_url !== 'vote') {
            navigator.hide();

            removeListeners();
        }
    });

    function removeListeners() {
        socket.removeListener('event:new_vote', Vote.onNewVote);
    }

    Vote.init = function () {
        app.enterRoom('vote');

        $('#new_vote').on('click', function () {
            composer.newVote();
        });
    };

    Vote.onNewVote = function(vote) {
    };

    return Vote;
});
