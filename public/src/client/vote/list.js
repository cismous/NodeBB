define('forum/votes/list', ['composer', 'navigator'], function (composer, navigator) {
	var VotesList = {};

	$(window).on('action:ajaxify.start', function (ev, data) {
		if (data && data.tpl_url !== 'vote') {
			navigator.hide();

			removeListeners();
		}
	});

	function removeListeners() {
		socket.removeListener('event:new_vote', VotesList.onNewVote);
	}

	VotesList.init = function () {
		app.enterRoom('vote_list');

		socket.removeListener('event:new_vote', VotesList.onNewVote);
		socket.on('event:new_vote', VotesList.onNewVote);

		$('#new_vote').on('click', function () {
			composer.newTopic();
		});
	};

	VotesList.onNewVote = function (vote) {
		console.log(vote);
		console.log('on new vote');
	};

	return VotesList;
});

