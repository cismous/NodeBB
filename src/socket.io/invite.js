'use strict';

var nconf = require('nconf'),
	async = require('async'),
	winston = require('winston'),
	invite = require('../invite'),
	categories = require('../categories'),
	privileges = require('../privileges'),
	plugins = require('../plugins'),
	notifications = require('../notifications'),
	threadTools = require('../threadTools'),
	websockets = require('./index'),
	user = require('../user'),
	db = require('../database'),
	meta = require('../meta'),
	events = require('../events'),
	utils = require('../../public/src/utils'),
	SocketInvite = {};

SocketInvite.post = function (socket, data, callback) {
	if (!data) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	invite.post({
		uid: socket.uid,
		username: data.username,
		email: data.email,
		content: data.content,
		req: websockets.reqFromSocket(socket)
	}, function (err, inviteData) {
		if (err) {
			return callback(err);
		}

		callback(null, inviteData);
		socket.emit('event:new_invite', inviteData);
	});
};

SocketInvite.edit = function (socket, data, callback) {
	if(!socket.uid) {
		return callback(new Error('[[error:not-logged-in]]'));
	} else if(!data || !data.iid || !data.username || !data.email || !data.content) {
		return callback(new Error('[[error:invalid-data]]'));
	} else if (!data.username || data.username.length < parseInt(meta.config.minimumTitleLength, 10)) {
		return callback(new Error('[[error:username-too-short, ' + meta.config.minimumTitleLength + ']]'));
	} else if (data.username.length > parseInt(meta.config.maximumTitleLength, 10)) {
		return callback(new Error('[[error:username-too-long, ' + meta.config.maximumTitleLength + ']]'));
	} else if (!data.content || data.content.length < parseInt(meta.config.minimumPostLength, 10)) {
		return callback(new Error('[[error:content-too-short, ' + meta.config.minimumPostLength + ']]'));
	} else if (data.content.length > parseInt(meta.config.maximumPostLength, 10)) {
		return callback(new Error('[[error:content-too-long, ' + meta.config.maximumPostLength + ']]'));
	}

	// uid, iid, username, email, content
	invite.edit({
		uid: socket.uid,
		iid: data.iid,
		username: data.username,
		email: data.email,
		content: data.content
	}, function(err) {
		if (err) {
			return callback(err);
		}

		websockets.in('invite_' + data.iid).emit('event:invite_edited', {
			iid: data.iid,
			username: data.username,
			email: data.email,
			content: data.content
		});

		callback();
	});
};

SocketInvite.delete = function(socket, data, callback) {
	callback = callback || function () {};

	if (!socket.uid) {
		return;
	}

	if (!data) {
		return callback(new Error('[[error:invalid-data]]'));
	}

	invite.delete(data.iid, function (err, callback) {
		callback = callback || function () {}

		if (err) {
			return callback(err);
		}

		websockets.in('invite_' + data.iid).emit('event:invite_deleted');

		events.log({
			type: 'invite-delete',
			uid: socket.uid,
			iid: data.iid,
			ip: socket.ip
		});

		callback();
	});
};

SocketInvite.enter = function (socket, tid, callback) {
	if (!parseInt(tid, 10) || !socket.uid) {
		return;
	}
	async.parallel({
		markAsRead: function (next) {
			SocketInvite.markAsRead(socket, [tid], next);
		},
		users: function (next) {
			websockets.getUsersInRoom(socket.uid, 'vote_' + tid, next);
		}
	}, function (err, result) {
		callback(err, result ? result.users : null);
	});
};

SocketInvite.upvote = function (socket, data, callback) {
	if (!data || !data.iid || !data.room_id) {
		return callback(new Error('[[error:invalid-data]]'));
	}
	async.parallel({
		exists: function (next) {
			invite.exists(data.iid, next);
		},
		deleted: function (next) {
			invite.getInviteField(data.iid, 'deleted', next);
		}
	}, function (err, results) {
		if (err || !results.exists) {
			return callback(err || new Error('[[error:invalid-pid]]'));
		}

		if (parseInt(results.deleted, 10) === 1) {
			return callback(new Error('[[error:post-deleted]]'));
		}

		invite.upVote(socket.uid, data.iid, true, callback);
	});
};

module.exports = SocketInvite;
