var tcp = require('../../tcp');
var instance_skel = require('../../instance_skel');
var debug;
var log;

// https://lightware.com/pub/media/lightware/filedownloader/file/Lightware_s_Open_API_Environment_v1.pdf
// http://fioerx.com/FILE/LIGHTWARE/MX32x32DVI-Pro_UserManual.pdf

function instance(system, id, config) {
	var self = this;

	self.CHOICES_INPUTS = [];
	self.CHOICES_OUTPUTS = [];

	// super-constructor
	instance_skel.apply(this, arguments);

	self.actions(); // export actions

	return self;
}

instance.prototype.updateConfig = function(config) {
	var self = this;

	self.config = config;
	self.init_tcp();
};

instance.prototype.init = function() {
	var self = this;

	debug = self.debug;
	log = self.log;

	self.status(self.STATE_UNKNOWN);

	self.init_tcp();
};

instance.prototype.init_tcp = function() {
	var self = this;
	var receivebuffer = '';
	self.responseHandlers = {};

	if (self.socket !== undefined) {
		self.socket.destroy();
		delete self.socket;
	}

	if (self.config.host) {
		self.socket = new tcp(self.config.host, 10001);

		self.socket.on('status_change', function (status, message) {
			self.status(status, message);
		});

		self.socket.on('connect', function () {
			self.socket.send("{i}\r\n{VC}\r\n");
		});

		self.socket.on('error', function (err) {
			debug("Network error", err);
			self.log('error',"Network error: " + err.message);
		});

		self.socket.on('data', function (chunk) {
			var i = 0, line = '', offset = 0;
			receivebuffer += chunk;

			while ( (i = receivebuffer.indexOf('\r\n', offset)) !== -1) {
				line = receivebuffer.substr(offset, i - offset);
				offset = i + 2;
				self.socket.emit('receiveline', line.toString());
			}
			receivebuffer = receivebuffer.substr(offset);
		});

		self.socket.on('receiveline', function (line) {
			var match;

			if (match = line.match(/\(ALL\s+(.+)\s?\)\s*$/)) {
				self.CHOICES_INPUTS.length = 0;
				self.CHOICES_OUTPUTS.length = 0;

				var outputs = match[1].split(/\s+/);
				if (outputs[outputs.length-1] == '') {
					outputs.length = outputs.length - 1;
				}

				// Assume equal number of inputs
				for (var i = 0; i < outputs.length; ++i) {
					self.CHOICES_INPUTS.push({ label: 'Input ' + (i + 1), id: i+1 });
					self.CHOICES_OUTPUTS.push({ label: 'Output ' + (i + 1), id: i+1 });
				}
			}
			else if (match = line.match(/\(i:\s*(.+)\)$/i)) {
				log('info', 'Connected to ' + match[1]);
			}
		});
	}
};

// Return config fields for web config
instance.prototype.config_fields = function () {
	var self = this;
	return [
		{
			type: 'text',
			id: 'info',
			width: 12,
			label: 'Information',
			value: 'This module is for controlling Lightware equipment that supports legacy LW2 protocol.'
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Device IP',
			width: 12,
			regex: self.REGEX_IP
		}
	]
};

// When module gets deleted
instance.prototype.destroy = function() {
	var self = this;

	if (self.socket !== undefined) {
		self.socket.destroy();
	}

	debug("destroy", self.id);
};


instance.prototype.actions = function(system) {
	var self = this;

	self.system.emit('instance_actions', self.id, {
		'xpt': {
			label: 'Switch one input to one output',
			options: [
				{
					label: 'Input',
					type: 'dropdown',
					id: 'input',
					choices: self.CHOICES_INPUTS
				},
				{
					label: 'Output',
					type: 'dropdown',
					id: 'output',
					choices: self.CHOICES_OUTPUTS
				}
			]
		}
	});
}

instance.prototype.action = function(action) {
	var self = this;
	var cmd;
	var opt = action.options;

	switch (action.action) {

		case 'xpt':
			cmd = '{' + opt.input + '@' + opt.output + '}';
			break;

	}

	debug('action():', action);

	if (cmd !== undefined) {
		if (self.socket !== undefined) {
			debug('sending ', cmd, "to", self.socket.host);
			self.socket.send(cmd + "\r\n");
		}
	}
};

instance_skel.extendedBy(instance);
exports = module.exports = instance;
