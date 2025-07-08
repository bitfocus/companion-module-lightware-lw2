const { InstanceBase, Regex, runEntrypoint, InstanceStatus, TCPHelper } = require('@companion-module/base')

class LightwareLW2Instance extends InstanceBase {
	constructor(internal) {
		super(internal)

		this.CHOICES_INPUTS = []
		this.CHOICES_OUTPUTS = []
		this.CHOICES_PRESETS = []

		this.presets = {}
		this.numPresets = 0
		this.xpt = {}
		this.socket = undefined
		this.receivebuffer = ''
		this.responseHandlers = {}
		this.checkPresets = undefined
	}

	async init(config) {
		this.config = config
		this.updateStatus(InstanceStatus.Connecting)
		this.initTCP()
		this.initFeedbacks()
	}

	async configUpdated(config) {
		this.config = config
		this.initTCP()
	}

	async destroy() {
		if (this.socket !== undefined) {
			this.socket.destroy()
			this.socket = undefined
		}
		this.log('debug', 'destroy')
	}

	getConfigFields() {
		return [
			{
				type: 'static-text',
				id: 'info',
				width: 12,
				label: 'Information',
				value: 'This module is for controlling Lightware equipment that supports legacy LW2 protocol. You have to specify the amount of Inputs. Outputs are autodetected.'
			},
			{
				type: 'textinput',
				id: 'host',
				label: 'Device IP',
				width: 12,
				regex: Regex.IP
			},
			{
				type: 'number',
				id: 'inputCount',
				label: 'Input Count',
				default: 40,
				width: 3,
				min: 0,
				max: 100,
				required: true,
				range: false
			}
		]
	}

	initTCP() {
		this.receivebuffer = ''
		this.responseHandlers = {}

		if (this.socket !== undefined) {
			this.socket.destroy()
			this.socket = undefined
		}

		if (this.config.host) {
			this.socket = new TCPHelper(this.config.host, 10001)

			this.socket.on('status_change', (status, message) => {
				this.updateStatus(status, message)
			})

			this.socket.on('connect', () => {
				this.socket.send("{i}\r\n{VC}\r\n")
				this.checkNumpresets()
			})

			this.socket.on('error', (err) => {
				this.log('error', "Network error: " + err.message)
			})

			this.socket.on('data', (chunk) => {
				let i = 0, line = '', offset = 0
				this.receivebuffer += chunk

				while ( (i = this.receivebuffer.indexOf('\r\n', offset)) !== -1) {
					line = this.receivebuffer.substr(offset, i - offset)
					offset = i + 2
					this.socket.emit('receiveline', line.toString())
				}
				this.receivebuffer = this.receivebuffer.substr(offset)
			})

			this.socket.on('receiveline', (line) => {
				this.processReceivedLine(line)
			})
		}
	}

	processReceivedLine(line) {
		let match
		
		if (match = line.match(/\(ALL\s+(.+)\s?\)\s*$/)) {
			this.CHOICES_INPUTS.length = 0
			this.CHOICES_OUTPUTS.length = 0

			const outputs = match[1].split(/\s+/)
			if (outputs[outputs.length-1] == '') {				
				outputs.length = outputs.length - 1
			}

			// Do Not Assume equal number of inputs, use Config
			for (let i = 0; i < outputs.length; ++i) {
				this.CHOICES_OUTPUTS.push({ label: 'Output ' + (i + 1), id: i+1 })
				this.setVariableValues({ ['output_' + (i+1)]: 'Output '+(i+1) })
				this.xpt[i+1] = parseInt(outputs[i])
			}
			for (let i = 0; i < this.config.inputCount; ++i) {
				this.CHOICES_INPUTS.push({ label: 'Input ' + (i + 1), id: i+1 })
				this.setVariableValues({ ['input_' + (i+1)]: 'Input '+(i+1) })
			}

			// Update inputs/outputs
			this.initActions()
			this.getIO()
			this.initFeedbacks()
			this.checkFeedbacks('xpt_color')
			this.initPresets()
		}
		else if (match = line.match(/(ERR04)/i)) {
			if (this.checkPresets !== undefined) {
				this.checkNumpresets()
			}
		}
		else if (match = line.match(/\(INAME#(\d+)=([^)]+)\)$/i)) {
			const id = parseInt(match[1])
			const name = match[2]
			this.setVariableValues({ ['input_' + id]: name })
			this.CHOICES_INPUTS[id - 1] = { label: name, id: id }

			// This is (regrettably) needed to update the dropdown boxes of inputs/outputs
			this.initActions()
			this.initPresets()
			this.initFeedbacks()
		}
		else if (match = line.match(/\(ONAME#(\d+)=([^)]+)\)$/i)) {
			const id = parseInt(match[1])
			const name = match[2]

			this.setVariableValues({ ['output_' + id]: name })
			this.CHOICES_OUTPUTS[id - 1] = { label: name, id: id }

			// This is (regrettably) needed to update the dropdown boxes of inputs/outputs
			this.initActions()
			this.initPresets()
			this.initFeedbacks()
		}
		else if (match = line.match(/\(PNAME#(\d+)=([^)]+)\)$/i)) {
			const id = parseInt(match[1])
			const name = match[2]

			if (this.checkPresets !== undefined) {
				this.log('debug', 'Detected ' + id + ' presets on LW2 device')
				this.numPresets = id
				this.checkPresets = undefined
				this.getPresets()
				this.initVariables()
				this.initPresets()
			} else {
				this.presets[id] = name
				this.setVariableValues({ ['preset_' + id]: this.presets[id] })
				this.CHOICES_PRESETS[id - 1] = { label: 'Preset ' + id + ': ' + name, id: id }
				this.initActions()
			}
		}
		else if (match = line.match(/\(O(\d+) I(\d+)\)/i)) {
			this.xpt[parseInt(match[1])] = parseInt(match[2])
			this.checkFeedbacks('xpt_color')
		}
		else if (match = line.match(/\(i:\s*(.+)\)$/i)) {
			this.log('info', 'Connected to ' + match[1])
		}
	}

	getIO() {
		for (let i = 0; i < this.CHOICES_INPUTS.length; ++i) {
			this.socket.send("{iname#" + (i+1) + "=?}")
		}
		for (let i = 0; i < this.CHOICES_OUTPUTS.length; ++i) {
			this.socket.send("{oname#" + (i+1) + "=?}")
		}			
	}

	getPresets() {
		for (let i = 0; i < this.numPresets; ++i) {
			this.socket.send("{pname#" + (i+1) + "=?}\r\n")
		}
	}

	checkNumpresets() {
		if (this.checkPresets === undefined) {
			this.CHOICES_PRESETS.length = 0
			this.checkPresets = 64
			this.socket.send("{pname#64=?}\r\n")
		} else if (this.checkPresets == 64) {
			this.checkPresets = 32
			this.socket.send("{pname#32=?}\r\n")
		} else if (this.checkPresets == 32) {
			this.checkPresets = 16
			this.socket.send("{pname#16=?}\r\n")
		} else if (this.checkPresets == 16) {
			this.checkPresets = 8
			this.socket.send("{pname#8=?}\r\n")
		} else {
			this.log('debug', 'Found no presets on device')
			this.checkPresets = undefined
		}
	}

	initVariables() {
		const variables = []

		for (let i = 0; i < this.numPresets; ++i) {
			variables.push({ name: 'preset_' + (i+1), label: 'Label of preset ' + (i+1) })
		}

		this.setVariableDefinitions(variables)
	}

	initFeedbacks() {
		this.setFeedbackDefinitions({
			xpt_color: {
				name: 'Change background color',
				description: 'If the input specified is in use by the output specified, change colors of the bank',
				type: 'boolean',
				defaultStyle: {
					bgcolor: this.rgb(255, 0, 0),
					color: this.rgb(255, 255, 255)
				},
				options: [
					{
						type: 'dropdown',
						label: 'Input',
						id: 'input',
						default: 1,
						choices: this.CHOICES_INPUTS
					},
					{
						type: 'dropdown',
						label: 'Output',
						id: 'output',
						default: 1,
						choices: this.CHOICES_OUTPUTS
					}
				],
				callback: (feedback) => {
					return this.xpt[parseInt(feedback.options.output)] == parseInt(feedback.options.input)
				}
			}
		})
	}

	initPresets() {
		const presets = {}

		for (let o = 0; o < this.CHOICES_OUTPUTS.length; ++o) {
			for (let i = 0; i < this.CHOICES_INPUTS.length; ++i) {
				presets[`input_${i+1}_output_${o+1}`] = {
					type: 'button',
					category: 'Output ' + (o + 1),
					name: 'Feedback button for input ' + (i + 1) + ' on output ' + (o + 1),
					style: {
						text: '$(lightware-lw2:input_' + (i+1) + ')\\n$(lightware-lw2:output_' + (o+1) + ')',
						size: 'auto',
						color: this.rgb(255, 255, 255),
						bgcolor: this.rgb(0, 0, 0)
					},
					feedbacks: [
						{
							feedbackId: 'xpt_color',
							options: {
								input: (i+1),
								output: (o+1)
							}
						}
					],
					steps: [
						{
							down: [
								{
									actionId: 'xpt',
									options: {
										input: (i+1),
										output: (o+1)
									}
								}
							],
							up: []
						}
					]
				}
			}
		}

		if (this.numPresets) {
			for (let i = 0; i < this.numPresets; ++i) {
				presets[`load_preset_${i+1}`] = {
					type: 'button',
					category: 'Load presets',
					name: 'Load button for preset ' + (i+1),
					style: {
						text: '$(lightware-lw2:preset_' + (i+1) + ')',
						size: 'auto',
						color: this.rgb(255, 255, 255),
						bgcolor: this.rgb(0, 0, 0)
					},
					steps: [
						{
							down: [
								{
									actionId: 'preset',
									options: {
										preset: (i+1)
									}
								}
							],
							up: []
						}
					]
				}
				presets[`save_preset_${i+1}`] = {
					type: 'button',
					category: 'Save presets',
					name: 'Save button for preset ' + (i+1),
					style: {
						text: '$(lightware-lw2:preset_' + (i+1) + ')',
						size: 'auto',
						color: this.rgb(255, 255, 255),
						bgcolor: this.rgb(0, 0, 0)
					},
					steps: [
						{
							down: [
								{
									actionId: 'savepreset',
									options: {
										preset: (i+1)
									}
								}
							],
							up: []
						}
					]
				}
			}
		}

		this.setPresetDefinitions(presets)
	}

	initActions() {
		const actions = {
			'xpt': {
				name: 'Switch one input to one output',
				options: [
					{
						label: 'Input',
						type: 'dropdown',
						id: 'input',
						choices: this.CHOICES_INPUTS,
						default: 1
					},
					{
						label: 'Output',
						type: 'dropdown',
						id: 'output',
						choices: this.CHOICES_OUTPUTS,
						default: 1
					}
				],
				callback: (action) => {
					const cmd = '{' + action.options.input + '@' + action.options.output + '}'
					this.sendCommand(cmd)
				}
			}
		}

		if (this.numPresets > 0) {
			actions['preset'] = {
				name: 'Load preset',
				options: [
					{
						label: 'Preset',
						type: 'dropdown',
						id: 'preset',
						choices: this.CHOICES_PRESETS,
						default: 1
					}
				],
				callback: (action) => {
					const cmd = '{%' + action.options.preset + '}'
					this.sendCommand(cmd)
				}
			}
			actions['savepreset'] = {
				name: 'Save preset',
				options: [
					{
						label: 'Preset',
						type: 'dropdown',
						id: 'preset',
						choices: this.CHOICES_PRESETS,
						default: 1
					}
				],
				callback: (action) => {
					const cmd = '{$' + action.options.preset + '}'
					this.sendCommand(cmd)
				}
			}
		}

		this.setActionDefinitions(actions)
	}

	sendCommand(cmd) {
		if (cmd !== undefined) {
			if (this.socket !== undefined) {
				this.log('debug', 'sending ' + cmd + ' to ' + this.config.host)
				this.socket.send(cmd + "\r\n")
			}
		}
	}
}

runEntrypoint(LightwareLW2Instance, [])
