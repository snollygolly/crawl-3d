// fakesocket.js -- stands in for the WebSocket the stock WebTiles client opens.
// Instead of a server, it talks to engine/worker.js, which runs Crawl itself.
(function() {
	"use strict";

	let the_socket = null;

	function FakeSocket(url, protocol)
	{
		const self = this;
		// eslint-disable-next-line consistent-this
		the_socket = this;
		this.readyState = 0;
		this.binaryType = "arraybuffer";
		this.worker = new Worker("engine/worker.js");
		this.worker.onmessage = function(ev) { self._from_worker(ev.data); };
		this.worker.onerror = function(ev) {
			window.crawl3d_status(`Engine error: ${ev.message || ev}`);
		};
		setTimeout(function() {
			self.readyState = 1;
			if (self.onopen) self.onopen();
		}, 0);
	}

	const debug = window.crawl3d_debug = { types: [], sent: [] };

	FakeSocket.prototype._deliver = function(text)
	{
		try {
			const re = /"msg":"([^"]+)"/g; let m;
			while ((m = re.exec(text)) && debug.types.length < 500)
				debug.types.push(m[1]);
		} catch (e) {}
		if (this.onmessage) this.onmessage({ data: text });
	};

	FakeSocket.prototype._from_worker = function(m)
	{
		switch (m.type)
		{
		case "msgs":
			this._deliver(m.data);
			break;
		case "client":
			// What the Python server does when crawl announces its client:
			// send the game page (game.html) for the client to load.
			window.crawl3d_hide_start();
			this._deliver(JSON.stringify({ msgs: [
				{ msg: "game_started" },
				{ msg: "game_client", version: "local",
					content: window.CRAWL3D_GAME_HTML }
			]}));
			break;
		case "status":
			window.crawl3d_status(m.text);
			break;
		case "exit":
			this.readyState = 3;
			window.crawl3d_game_over(m);
			break;
		}
	};

	FakeSocket.prototype.send = function(text)
	{
		if (debug.sent.length < 300) debug.sent.push(text.slice(0, 120));
		this.worker.postMessage({ type: "send", data: text });
	};

	FakeSocket.prototype.close = function() {};

	window.WebSocket = FakeSocket;

	window.crawl3d_start = function(name, extra_args)
	{
		if (!the_socket) return false;
		the_socket.worker.postMessage({ type: "start", name: name,
			extra_args: extra_args || [] });
		return true;
	};
}());
