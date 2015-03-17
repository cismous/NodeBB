"use strict";

var SocketVote = {},
    votes = require('../votes'),
    websockets = require('./index');

SocketVote.post = function (socket, data, callback) {
    if (!data) {
        return callback(new Error('[[error:invalid-data]]'));
    }

    votes.post({
        uid: socket.uid,
        vid: data.vid,
        handle: data.handle,
        email: data.email,
        username: data.username,
        content: data.content,
        req: websockets.reqFromSocket(socket)
    }, function (err, result) {
        if (err) {
            return callback(err);
        }

        callback(null, result.voteData);
        socket.emit('event:new_post', {posts: [result.postData]});
        socket.emit('event:new_vote', result.voteData);
    });
};

module.exports = SocketVote;
