class SourceInstance {
    static LISTENER_PLAY = 0;

    static DEFAULT_PANNER_ATTRIBUTES = {
        coneInnerAngle: 360,
        coneOuterAngle: 360,
        coneOuterGain: 0,
        distanceModel: 'inverse',
        maxDistance: 10000,
        panningModel: 'HRTF',
        refDistance: 100,
        rolloffFactor: 100,
    };
    
    // buffer -> gain -> [extras] -> panner -> destination

    _connectedBuffer;

    _source;
    _bufferInstance;

    _playing;
    _sourceLoadedCallback;

    _gainNode;
    _pannerNode;
    _scriptNode;

    _playbackRate;
    _loop;

    _lastRateChangeTime;
    _previousAccumulatedTime;

    _listeners;
    _onceListeners;

    _extraNodes;
    _queuedProperties;

    constructor(source) {
        this._connectedBuffer = false;

        this._source = source;
        this._bufferInstance = null;

        this._playing = false;
        this._sourceLoadedCallback = null;

        this._gainNode = null;
        this._pannerNode = null;
        this._scriptNode = null;
        this._playbackRate = 1;
        this._loop = source.getLoop ? source.getLoop() : false;

        this._lastRateChangeTime = 0;
        this._previousAccumulatedTime = 0;

        this._listeners = {};
        this._onceListeners = {};

        this._extraNodes = [];
        this._queuedProperties = null;

        const sourceVolume = source.getVolume();
        if (sourceVolume !== 1) {
            this.setVolume(sourceVolume);
        }

        // extra nodes dont exist here so we dont check
        if (this._source.isReady()) {
            this._connect();
        }
    }

    play(offset) {
        if (this._lastRateChangeTime) {
            return this;
        }
        this._lastRateChangeTime = Date.now();
        this._previousAccumulatedTime = (offset ?? 0) * 1000;

        if (this._source.isReady() && this._areExtraNodesReady() && !this._connectedBuffer) {
            this._connect();
        }

        if (this._connectedBuffer) {
            this._play();
        } else if (!this._connectedBuffer && !this._sourceLoadedCallback) {
            this._sourceLoadedCallback = this._onSourceLoaded.bind(this);

            this._source.addEventListener(Source.LISTENER_READY, this._sourceLoadedCallback);
        }

        return this;
    }

    stop() {
        this._lastRateChangeTime = 0;
        this._previousAccumulatedTime = 0;

        if (this._sourceLoadedCallback) {
            this._source.removeEventListener(Source.LISTENER_READY, this._sourceLoadedCallback);
            this._sourceLoadedCallback = null;
        }

        if (this._playing) {
            this._playing = false;
            if (this._bufferInstance.stop) {
                this._bufferInstance.stop();
            }
        }

        if (this._connectedBuffer) {
            this._disconnect();
        }

        return this;
    }

    isPlaying() {
        return this._playing;
    }

    setPannerAttributes(options) {
        if (!this._pannerNode) {
            this._createPannerNode();
        }

        if (options.coneInnerAngle !== undefined) {
            this._pannerNode.coneInnerAngle = options.coneInnerAngle;
        }
        if (options.coneOuterAngle !== undefined) {
            this._pannerNode.coneOuterAngle = options.coneOuterAngle;
        }
        if (options.coneOuterGain !== undefined) {
            this._pannerNode.coneOuterGain = options.coneOuterGain;
        }
        if (options.distanceModel !== undefined) {
            this._pannerNode.distanceModel = options.distanceModel;
        }
        if (options.maxDistance !== undefined) {
            this._pannerNode.maxDistance = options.maxDistance;
        }
        if (options.panningModel !== undefined) {
            this._pannerNode.panningModel = options.panningModel;
        }
        if (options.refDistance !== undefined) {
            this._pannerNode.refDistance = options.refDistance;
        }
        if (options.rolloffFactor !== undefined) {
            this._pannerNode.rolloffFactor = options.rolloffFactor;
        }

        return this;
    }

    setPannerPosition(x, y, z) {
        if (!this._pannerNode) {
            this._createPannerNode();
        }

        this._pannerNode.positionX.linearRampToValueAtTime(x, NSWA.context.currentTime + 0.05);
        this._pannerNode.positionY.linearRampToValueAtTime(y, NSWA.context.currentTime + 0.05);
        this._pannerNode.positionZ.linearRampToValueAtTime(z, NSWA.context.currentTime + 0.05);

        return this;
    }

    setPannerOrientation(x, y, z) {
        if (!this._pannerNode) {
            this._createPannerNode();
        }

        this._pannerNode.orientationX.linearRampToValueAtTime(x, NSWA.context.currentTime + 0.05);
        this._pannerNode.orientationY.linearRampToValueAtTime(y, NSWA.context.currentTime + 0.05);
        this._pannerNode.orientationZ.linearRampToValueAtTime(z, NSWA.context.currentTime + 0.05);

        return this;
    }

    removePanner() {
        if (!this._pannerNode) {
            return this;
        }

        const previousNode = NSWA.getNode(this._getPreviousNode(this._pannerNode));
        const nextNode = NSWA.getNode(this._getNextNode(this._pannerNode));

        this._pannerNode.disconnect();
        previousNode.disconnect();
        previousNode.connect(nextNode);

        return this;
    }

    setScriptNode(script) {

    }

    getCurrentTime() {
        if (this._lastRateChangeTime === 0) {
            return 0;
        }

        return ((Date.now() - this._lastRateChangeTime) * this._playbackRate + this._previousAccumulatedTime) / 1000.0;
    }

    seek(time) {
        this.stop();

        this.play(time);

        return this;
    }

    getRate() {
        return this._playbackRate;
    }

    setRate(rate) {
        if (this._playbackRate === rate) {
            return this;
        }

        const now = Date.now();
        const deltaTime = now - this._lastRateChangeTime;
        this._previousAccumulatedTime += deltaTime * this._playbackRate;
        this._lastRateChangeTime = now;

        this._playbackRate = rate;

        if (this._bufferInstance) {
            this._bufferInstance.playbackRate.value = rate;
        }

        return this;
    }

    getLoop() {
        return this._loop;
    }

    setLoop(loop) {
        if (this._loop === loop) {
            return this;
        }

        if (this._connectedBuffer) {
            this._bufferInstance.loop = loop;
        }

        return this;
    }

    getVolume() {
        if (!this._gainNode) {
            return 1;
        }

        return this._gainNode.gain.value;
    }

    setVolume(volume) {
        if (!this._gainNode) {
            this._createGainNode();
        }

        this._gainNode.gain.setValueAtTime(volume, NSWA.context.currentTime);

        return this;
    }

    hasExtraNode(node) {
        for (let i = 0; i < this._extraNodes.length; i++) {
            if (this._extraNodes[i] === node) {
                return true;
            }
        }

        return false;
    }

    addExtraNode(node) {
        if (!(node instanceof NodeBase)) {
            console.error('You can only add nodes that are of type NodeBase.');
            return this;
        }

        for (let i = 0; i < this._extraNodes.length; i++) {
            if (this._extraNodes[i] === node) {
                return this;
            }
        }

        this._extraNodes.push(node);

        // connected buffer means everythings ready
        if (!node.isReady()) {
            node.addEventListener(Source.LISTENER_READY, this._onExtraNodeLoaded.bind(this), true);
        } else if (this._connectedBuffer) {
            this._onExtraNodeLoaded();
        }

        return this;
    }

    removeExtraNode(node) {
        let removedNode = false;
        let previousNode = NSWA.getNode(this._getPreviousNode(node));
        let nextNode = NSWA.getNode(this._getNextNode(node));
        for (let i = 0; i < this._extraNodes.length; i++) {
            if (this._extraNodes[i] === node) {
                removedNode = true;

                for (let a = i; a < this._extraNodes.length - 1; a++) {
                    this._extraNodes[a] = this._extraNodes[a + 1];
                    this._extraNodes.length -= 1;
                }

                break;
            }
        }

        if (!removedNode) {
            return this;
        }

        NSWA.getNode(node).disconnect();
        previousNode.disconnect();
        previousNode.connect(nextNode);

        return this;
    }

    destroy() {
        // delete listeners and stop the audio
        // stop auto deletes the listeners if there are any
        this.stop();
    }

    addEventListener(event, callback, once) {
        switch (event) {
            case SourceInstance.LISTENER_PLAY: {
                if (this.isPlaying()) {
                    callback();
                    return;
                }
            } break;

            default:
                console.error('Received unknown listener type.', event);
                return;
        }

        if (once) {
            if (!this._onceListeners[event]) {
                this._onceListeners[event] = [];
            }

            this._onceListeners[event].push(callback);
        } else {
            if (!this._listeners[event]) {
                this._listeners[event] = [];
            }

            this._listeners[event].push(callback);
        }
    }

    removeEventListener(event, callback, once) {
        if (once) {
            if (!this._onceListeners[event]) {
                return;
            }

            const index = this._onceListeners[event].indexOf(callback);
            if (index >= 0) {
                NSWA._removeArray(this._onceListeners[event], index);

                if (this._onceListeners[event].length === 0) {
                    delete this._onceListeners[event];
                }
            }
        } else {
            if (!this._listeners[event]) {
                return;
            }

            const index = this._listeners[event].indexOf(callback);
            if (index >= 0) {
                NSWA._removeArray(this._listeners[event], index);

                if (this._listeners[event].length === 0) {
                    delete this._listeners[event];
                }
            }
        }
    }

    getProperty(name) {
        if (!this._bufferInstance) {
            return null;
        }

        this._bufferInstance.parameters.get(name).value;
    }

    setProperty(name, value) {
        if (!this._bufferInstance) {
            this._queuedProperties = this._queuedProperties || {};
            this._queuedProperties[name] = value;
            return this;
        }

        this._bufferInstance.parameters.get(name).setValueAtTime(value, NSWA.context.currentTime);

        return this;
    }

    _areExtraNodesReady() {
        let ready = true;
        for (let i = 0; i < this._extraNodes.length; i++) {
            ready = ready && this._extraNodes[i].isReady();
        }

        return ready;
    }

    _onEvent(event) {
        if (this._listeners[event]) {
            const listeners = this._listeners[event];
            for (let i = listeners.length - 1; i >= 0; i--) {
                listeners[i]();
            }
        }

        if (this._onceListeners[event]) {
            const onceListeners = this._onceListeners[event];
            for (let i = onceListeners.length - 1; i >= 0; i--) {
                onceListeners[i]();
            }
            delete this._onceListeners[event];
        }
    }

    _play() {
        if (this._playing) {
            return;
        }

        if (!this._connectedBuffer) {
            return;
        }

        // play for real
        this._playing = true;
        if (this._bufferInstance.start) {
            this._bufferInstance.start(0, this.getCurrentTime());
        }
        this._onEvent(SourceInstance.LISTENER_PLAY);
    }

    _createPannerNode() {
        if (this._pannerNode) {
            return;
        }

        this._pannerNode = NSWA.context.createPanner();
        this._pannerNode.coneInnerAngle = SourceInstance.DEFAULT_PANNER_ATTRIBUTES.coneInnerAngle;
        this._pannerNode.coneOuterAngle = SourceInstance.DEFAULT_PANNER_ATTRIBUTES.coneOuterAngle;
        this._pannerNode.coneOuterGain = SourceInstance.DEFAULT_PANNER_ATTRIBUTES.coneOuterGain;
        this._pannerNode.distanceModel = SourceInstance.DEFAULT_PANNER_ATTRIBUTES.distanceModel;
        this._pannerNode.maxDistance = SourceInstance.DEFAULT_PANNER_ATTRIBUTES.maxDistance;
        this._pannerNode.panningModel = SourceInstance.DEFAULT_PANNER_ATTRIBUTES.panningModel;
        this._pannerNode.refDistance = SourceInstance.DEFAULT_PANNER_ATTRIBUTES.refDistance;
        this._pannerNode.rolloffFactor = SourceInstance.DEFAULT_PANNER_ATTRIBUTES.rolloffFactor;

        // if the buffer is already connected, stick this after the gain?
        if (this._connectedBuffer) {
            const previous = NSWA.getNode(this._getPreviousNode(this._pannerNode));
            const next = NSWA.getNode(this._getNextNode(this._pannerNode));
            previous.disconnect();
            previous.connect(this._pannerNode);
            this._pannerNode.connect(next);
        }
    }

    _createGainNode() {
        if (this._gainNode) {
            return;
        }

        this._gainNode = NSWA.context.createGain();
        
        if (this._connectedBuffer) {
            const previous = NSWA.getNode(this._getPreviousNode(this._gainNode));
            const next = NSWA.getNode(this._getNextNode(this._gainNode));
            previous.disconnect();
            previous.connect(this._gainNode);
            this._gainNode.connect(next);
        }

        // console.warn('Creating a gain node for individual audio components is not performant. Consider lowering the volume of the audio file.');
    }

    _getPreviousNode(node) {
        if (node === this._gainNode) {
            return this._bufferInstance;
        } else if (node === this._pannerNode) {
            if (this._extraNodes.length > 0 && this._areExtraNodesReady()) {
                return this._extraNodes[this._extraNodes.length - 1];
            } else if (this._gainNode) {
                return this._gainNode;
            }

            return this._bufferInstance;
        } else if (node === NSWA.destination) {
            if (this._pannerNode) {
                return this._pannerNode;
            } else if (this._extraNodes.length > 0 && this._areExtraNodesReady()) {
                return this._extraNodes[this._extraNodes.length - 1];
            } else if (this._gainNode) {
                return this._gainNode;
            }

            return this._bufferInstance;
        } else if (this._extraNodes.length > 0 && this._areExtraNodesReady()) {
            for (let i = 0; i < this._extraNodes.length; i++) {
                if (node === this._extraNodes[i]) {
                    if (i > 0) {
                        return this._extraNodes[i - 1];
                    } else if (this._gainNode) {
                        return this._gainNode;
                    } else {
                        return this._bufferInstance;
                    }
                }
            }

            return null;
        }

        return null;
    }

    _getNextNode(node) {
        if (node === this._bufferInstance) {
            if (this._gainNode) {
                return this._gainNode;
            } else if (this._extraNodes.length > 0 && this._areExtraNodesReady()) {
                return this._extraNodes[0];
            } else if (this._pannerNode) {
                return this._pannerNode;
            }

            return NSWA.destination;
        } else if (node === this._gainNode) {
            if (this._extraNodes.length > 0 && this._areExtraNodesReady()) {
                return this._extraNodes[0];
            }
            if (this._pannerNode) {
                return this._pannerNode;
            }

            return NSWA.destination;
        } else if (node === this._pannerNode) {
            return NSWA.destination;
        } else if (this._extraNodes.length > 0 && this._areExtraNodesReady()) {
            for (let i = 0; i < this._extraNodes.length; i++) {
                if (node === this._extraNodes[i]) {
                    if (i < this._extraNodes.length - 1) {
                        return this._extraNodes[i + 1];
                    } else if (this._pannerNode) {
                        return this._pannerNode;
                    } else {
                        return NSWA.destination;
                    }
                }
            }

            return null;
        }

        return null;
    }

    _connect() {
        if (this._connectedBuffer) {
            return;
        }

        if (!this._source.isReady() || !this._areExtraNodesReady()) {
            return;
        }

        this._connectedBuffer = true;
        this._bufferInstance = this._source.createNode();
        if (this._queuedProperties) {
            for (const property in this._queuedProperties) {
                this.setProperty(property, this._queuedProperties[property])
            }
            this._queuedProperties = null;
        }
        // TODO should I use setTargetAtTime?
        if (this._bufferInstance.playbackRate) {
            this._bufferInstance.playbackRate.value = this._playbackRate;
        }
        if (this._bufferInstance.loop) {
            this._bufferInstance.loop = this._loop;
        }

        let currentNode = this._bufferInstance;
        let nextNode = this._getNextNode(currentNode);
        while (nextNode) {
            currentNode.connect(NSWA.getNode(nextNode));
            currentNode = nextNode;
            nextNode = this._getNextNode(currentNode);
        }
    }

    _disconnect() {
        if (!this._connectedBuffer) {
            return;
        }
        this._connectedBuffer = false;

        let previousNode = this._getPreviousNode(NSWA.destination);
        while (previousNode) {
            NSWA.getNode(previousNode).disconnect();
            previousNode = this._getPreviousNode(previousNode);
        }

        this._bufferInstance = null;
    }

    _onExtraNodeLoaded() {
        // fix the extra nodes if everything is already connected
        if (!this._connectedBuffer || !this._areExtraNodesReady()) {
            return;
        }

        if (this._extraNodes.length === 0) {
            return;
        }

        let currentNode = this._getPreviousNode(this._extraNodes[0]);
        let nextNode = this._extraNodes[0];
        while (nextNode) {
            NSWA.getNode(currentNode).disconnect();
            NSWA.getNode(currentNode).connect(NSWA.getNode(nextNode));
            currentNode = nextNode;
            nextNode = this._getNextNode(currentNode);
        }
    }

    _onSourceLoaded() {
        if (this._sourceLoadedCallback) {
            this._source.removeEventListener(Source.LISTENER_READY, this._sourceLoadedCallback);
            this._sourceLoadedCallback = null;
        }
        this._connect();

        if (!this._connectedBuffer) {
            return;
        }

        this._play();
    }
}

class ListenerBase {
    static LISTENER_READY = 0;

    _listeners;
    _onceListeners;
    _ready;

    constructor() {
        this._listeners = {};
        this._onceListeners = {};
        this._ready = false;
    }

    addEventListener(event, callback, once) {
        switch (event) {
            case Source.LISTENER_READY: {
                if (this._ready) {
                    callback();
                    return;
                }
            } break;

            default:
                console.error('Received unknown listener type.', event);
                return;
        }

        // add the listener
        if (once) {
            if (!this._onceListeners[event]) {
                this._onceListeners[event] = [];
            }

            this._onceListeners[event].push(callback);
        } else {
            if (!this._listeners[event]) {
                this._listeners[event] = [];
            }

            this._listeners[event].push(callback);
        }
    }

    removeEventListener(event, callback, once) {
        if (once) {
            if (!this._onceListeners[event]) {
                return;
            }

            const index = this._onceListeners[event].indexOf(callback);
            if (index >= 0) {
                NSWA._removeArray(this._onceListeners[event], index);

                if (this._onceListeners[event].length === 0) {
                    delete this._onceListeners[event];
                }
            }
        } else {
            if (!this._listeners[event]) {
                return;
            }

            const index = this._listeners[event].indexOf(callback);
            if (index >= 0) {
                NSWA._removeArray(this._listeners[event], index);

                if (this._listeners[event].length === 0) {
                    delete this._listeners[event];
                }
            }
        }
    }

    _onEvent(event) {
        if (this._listeners[event]) {
            const listeners = this._listeners[event];
            for (let i = listeners.length - 1; i >= 0; i--) {
                listeners[i]();
            }
        }

        if (this._onceListeners[event]) {
            const onceListeners = this._onceListeners[event];
            for (let i = onceListeners.length - 1; i >= 0; i--) {
                onceListeners[i]();
            }
            delete this._onceListeners[event];
        }
    }
}

class SourceBase extends ListenerBase {
    _loaded;
    _contextRunning;

    _audioBuffer;

    _path;
    _volume;

    constructor(path, options) {
        super();

        this._loaded = false;
        this._path = path;
        this._volume = options?.volume ?? 1;

        this._contextRunning = NSWA.context.state === 'running';
        if (!this._contextRunning) {
            NSWA.requestContextResume(this._onchangeContextState.bind(this));
        }

        this._audioBuffer = null;
    }

    createNode() {
        throw 'Invalid.';
    }

    getPath() {
        return this._path;
    }

    isReady() {
        return this._ready;
    }

    getVolume() {
        return this._volume;
    }

    setVolume(volume) {
        this._volume = volume;
    }

    create() {
        return new SourceInstance(this);
    }

    destroy() {
        throw 'I don\'t yet have a need to destroy audio sources.';
    }

    _onloadResult(result) {
        throw 'Invalid.';
    }

    _checkReady() {
        const ready = this._loaded && this._contextRunning;
        if (this._ready || !ready) {
            return;
        }
        this._ready = true;

        this._onEvent(Source.LISTENER_READY);
    }

    _onchangeContextState() {
        if (NSWA.context.state !== 'running') {
            return;
        }
        this._contextRunning = true;

        this._checkReady();
    }
}

class Source extends SourceBase {
    _loop;

    constructor(path, options) {
        super(path, options);

        this._loop = options?.loop ?? false;

        const response = fetch(path);
        response.then(this._onloadResult.bind(this));
    }

    createNode() {
        const bufferInstance = NSWA.context.createBufferSource();
        bufferInstance.buffer = this._audioBuffer;

        return bufferInstance;
    }

    getDuration() {
        if (!this._audioBuffer) {
            return 0;
        }

        return this._audioBuffer.duration;
    }

    getLoop() {
        return this._loop;
    }

    setLoop(loop) {
        this._loop = loop;
    }

    _onloadResult(result) {
        if (result.status !== 200) {
            console.error('Could not load audio source.', result.url, result.status, result.statusText);
            return;
        }

        result.arrayBuffer().then(this._onloadArrayBuffer.bind(this));
    }

    _onloadArrayBuffer(arrayBuffer) {
        NSWA.context.decodeAudioData(arrayBuffer).then(this._onloadAudioBuffer.bind(this));
    }

    _onloadAudioBuffer(audioBuffer) {
        this._loaded = true;
        this._audioBuffer = audioBuffer;

        this._checkReady();
    }
}

class ScriptSource extends SourceBase {
    _name;

    static _loadingNameCallbacks = {};
    static _loadedNames = {};

    constructor(script, name, options) {
        super(NSWA._createWorkletURL(script), options);

        console.log(this._path);

        this._name = name;

        if (ScriptSource._loadedNames[name]) {
            this._onloadResult();
        } else {
            if (ScriptSource._loadingNameCallbacks[name]) {
                ScriptSource._loadingNameCallbacks[name].push(() => {
                    this._onloadResult();
                });
            } else {
                ScriptSource._loadingNameCallbacks[name] = [];

                console.log('requested ', this._name, this._path);
                const response = NSWA.context.audioWorklet.addModule(this._path);
                response.then(this._onloadResult.bind(this)).catch(error => console.error('ScriptSource', error));
            }
        }
    }

    createNode() {
        return new AudioWorkletNode(NSWA.context, this._name);
    }

    _onloadResult() {
        console.log('loaded ', this._name);
        this._loaded = true;

        if (!ScriptSource._loadedNames[this._name]) {
            ScriptSource._loadedNames[this._name] = true;

            const callbacks = ScriptSource._loadingNameCallbacks[this._name];
            delete ScriptSource._loadingNameCallbacks[this._name];

            for (let i = 0; i < callbacks.length; i++) {
                callbacks[i]();
            }
        }

        this._checkReady();
    }
}

class NodeBase extends ListenerBase {
    _url;
    _name;
    _node;
    _connected;
    _queuedProperties;

    static _loadingNameCallbacks = {};
    static _loadedNames = {};

    constructor(script, name) {
        super();

        this._url = NSWA._createWorkletURL(script);
        this._name = name;
        this._node = null;
        this._connected = false;
        this._queuedProperties = null;

        if (NodeBase._loadedNames[name]) {
            this._onloadResult();
        } else {
            if (NodeBase._loadingNameCallbacks[name]) {
                NodeBase._loadingNameCallbacks[name].push(() => {
                    this._onloadResult();
                });
            } else {
                NodeBase._loadingNameCallbacks[name] = [];

                const response = NSWA.context.audioWorklet.addModule(this._url);
                response.then(this._onloadResult.bind(this));
            }
        }
    }

    getNode() {
        return this._node;
    }

    getProperty(name) {
        if (!this._node) {
            return null;
        }

        this._node.parameters.get(name).value;
    }

    setProperty(name, value) {
        if (!this._node) {
            this._queuedProperties = this._queuedProperties || {};
            this._queuedProperties[name] = value;
            return this;
        }

        this._node.parameters.get(name).setValueAtTime(value, NSWA.context.currentTime);

        return this;
    }

    isReady() {
        return this._ready;
    }

    _onloadResult() {
        this._node = new AudioWorkletNode(NSWA.context, this._name);
        this._ready = true;

        if (this._queuedProperties) {
            for (const property in this._queuedProperties) {
                this.setProperty(property, this._queuedProperties[property])
            }
            this._queuedProperties = null;
        }

        if (!NodeBase._loadedNames[this._name]) {
            NodeBase._loadedNames[this._name] = true;

            const callbacks = NodeBase._loadingNameCallbacks[this._name];
            delete NodeBase._loadingNameCallbacks[this._name];

            for (let i = 0; i < callbacks.length; i++) {
                callbacks[i]();
            }
        }

        this._onEvent(Source.LISTENER_READY);
    }
}

class ByteReaderNode extends NodeBase {
    constructor() {
        super(BYTE_READER_PROCESSOR, 'byte-reader-processor');
    }

    getStride() {
        return this.getProperty('stride');
    }

    setStride(stride) {
        this.setProperty('stride', stride);
    }
}

class BytePitchShiftedReaderNode extends NodeBase {
    constructor() {
        super(BYTE_PITCH_SHIFTED_READER_PROCESSOR, 'byte-pitch-shifted-reader-processor');

        this.setProperty('sampleRate', NSWA.context.sampleRate);
    }

    getStride() {
        return this.getProperty('stride');
    }

    setStride(stride) {
        this.setProperty('stride', stride);
    }

    getPitchShift() {
        return this.getProperty('pitchShift');
    }

    setPitchShift(pitchShift) {
        this.setProperty('pitchShift', pitchShift);
    }

    getQuality() {
        return this.getProperty('quality');
    }

    setQuality(quality) {
        this.setProperty('quality', quality);
    }
}

class BassTrebleNode extends NodeBase {
    constructor() {
        super(BASS_TREBLE_PROCESSOR, 'bass-treble-processor');

        this.setProperty('sampleRate', NSWA.context.sampleRate);
    }

    getBassGain() {
        return this.getProperty('bassGain');
    }

    setBassGain(bassGain) {
        this.setProperty('bassGain', bassGain);
    }

    getTrebleGain() {
        return this.getProperty('trebleGain');
    }

    setTrebleGain(trebleGain) {
        this.setProperty('trebleGain', trebleGain);
    }

    getGain() {
        return this.getProperty('gain');
    }

    setGain(gain) {
        this.setProperty('gain', gain);
    }
}

class ByteOutput extends SourceInstance {
    constructor() {
        super(new ScriptSource(BYTE_WRITER_PROCESSOR, 'byte-writer-processor'));
    }

    getStride() {
        return this.getProperty('stride');
    }

    setStride(stride) {
        this.setProperty('stride', stride);
    }

    getPlayBufferWrites() {
        return this.getProperty('playBufferWrites');
    }

    setPlayBufferWrites(playBufferWrites) {
        this.setProperty('playBufferWrites', playBufferWrites);
    }
}

class MicrophoneInput {
    onBytes;
    readerNode;

    constructor() {
        navigator.mediaDevices.getUserMedia({audio: true}).then(stream => {
            const microphone = NSWA.context.createMediaStreamSource(stream);

            this.readerNode = new ByteReaderNode();
            this.readerNode.addEventListener(NSWA.Source.LISTENER_READY, () => {
                this.readerNode.getNode().port.onmessage = (event) => {
                    const data = event.data;

                    if (this.onBytes) {
                        this.onBytes(data);
                    }
                };

                microphone.connect(this.readerNode.getNode());
            });
        });
    }

    getStride() {
        return this.readerNode.getStride();
    }

    setStride(stride) {
        this.readerNode.setStride(stride);
    }
}

class MicrophonePitchShiftedInput {
    onBytes;
    readerNode;

    constructor() {
        navigator.mediaDevices.getUserMedia({audio: true}).then(stream => {
            const microphone = NSWA.context.createMediaStreamSource(stream);

            this.readerNode = new BytePitchShiftedReaderNode();
            this.readerNode.addEventListener(NSWA.Source.LISTENER_READY, () => {
                this.readerNode.getNode().port.onmessage = (event) => {
                    const data = event.data;

                    if (this.onBytes) {
                        this.onBytes(data);
                    }
                };

                microphone.connect(this.readerNode.getNode());
            });
        });
    }

    getStride() {
        return this.readerNode.getStride();
    }

    setStride(stride) {
        this.readerNode.setStride(stride);
    }

    getPitchShift() {
        return this.readerNode.getPitchShift();
    }

    setPitchShift(pitchShift) {
        this.readerNode.setPitchShift(pitchShift);
    }

    getQuality() {
        return this.readerNode.getQuality();
    }

    setQuality(quality) {
        this.readerNode.setQuality(quality);
    }
}

const NSWA = {
    ByteReaderNode,
    BytePitchShiftedReaderNode,
    ByteSource,
    BassTrebleNode,
    context: new (window.AudioContext ?? window.webAudioContext)(),
    destination: null,
    MicrophoneInput,
    MicrophonePitchShiftedInput,
    NodeBase,
    ScriptSource,
    SourceBase,
    Source,
    setListenerOrientation: function(forwardX, forwardY, forwardZ, upX, upY, upZ) {
        NSWA.context.listener.forwardX.linearRampToValueAtTime(forwardX, NSWA.context.currentTime + 0.05);
        NSWA.context.listener.forwardY.linearRampToValueAtTime(forwardY, NSWA.context.currentTime + 0.05);
        NSWA.context.listener.forwardZ.linearRampToValueAtTime(forwardZ, NSWA.context.currentTime + 0.05);
        NSWA.context.listener.upX.linearRampToValueAtTime(upX, NSWA.context.currentTime + 0.05);
        NSWA.context.listener.upY.linearRampToValueAtTime(upY, NSWA.context.currentTime + 0.05);
        NSWA.context.listener.upZ.linearRampToValueAtTime(upZ, NSWA.context.currentTime + 0.05);
    },
    setListenerPosition: function(x, y, z) {
        NSWA.context.listener.positionX.linearRampToValueAtTime(x, NSWA.context.currentTime + 0.05);
        NSWA.context.listener.positionY.linearRampToValueAtTime(y, NSWA.context.currentTime + 0.05);
        NSWA.context.listener.positionZ.linearRampToValueAtTime(z, NSWA.context.currentTime + 0.05);
    },
    setVolume(volume) {
        NSWA.destination.gain.setValueAtTime(volume, NSWA.context.currentTime);
    },
    requestContextResume: function(callback) {
        if (NSWA.context.state === 'running') {
            if (callback) {
                callback();
            }
            return;
        }

        if (callback) {
            const index = NSWA._contextResumeListeners.indexOf(callback);
            if (index === -1) {
                NSWA._contextResumeListeners.push(callback);
            }
        }

        if (!NSWA._requestedContextResume) {
            NSWA._requestedContextResume = true;

            NSWA.context.addEventListener('statechange', NSWA._stateChangeListener);
            window.addEventListener('click', NSWA._inputListener);
            window.addEventListener('keydown', NSWA._inputListener);
            window.addEventListener('touchstart', NSWA._inputListener);
        }
    },
    getNode(node) {
        if (node instanceof NodeBase) {
            return node.getNode();
        }
        return node;
    },
    _requestedContextResume: false,
    _contextResumeListeners: [],
    _removeArray: function(array, index) {
        for (let i = index; i < array.length - 1; i++) {
            array[i] = array[i + 1];
        }

        array.length--;
    },
    _stateChangeListener: function() {
        const running = NSWA.context.state === 'running';
        if (running) {
            for (let i = 0; i < NSWA._contextResumeListeners.length; i++) {
                NSWA._contextResumeListeners[i]();
            }
            NSWA._contextResumeListeners.length = 0;

            if (NSWA._requestedContextResume) {
                NSWA._requestedContextResume = false;

                window.removeEventListener('click', NSWA._inputListener);
                window.removeEventListener('keydown', NSWA._inputListener);
                window.removeEventListener('touchstart', NSWA._inputListener);
            }
        } else {
            NSWA.requestContextResume();
        }
    },
    _inputListener: function() {
        NSWA.context.resume();
    },
    _createWorkletURL: function(script) {
        if (workletPaths[script]) {
            return workletPaths[script];
        }

        const url = URL.createObjectURL(new Blob([script], {type: 'application/javascript'}));
        workletPaths[script] = url;
        return url;
    },
};

const workletPaths = {};

NSWA.destination = NSWA.context.createGain();
NSWA.destination.connect(NSWA.context.destination);

if (NSWA.context.state !== 'running') {
    NSWA.requestContextResume();
}

const BYTE_WRITER_PROCESSOR = `
class ByteWriterProcessor extends AudioWorkletProcessor {
    constructor() {
        super();

        this.readIndex = 0;
        this.writeIndex = 0;
        this.bytes = [];

        this.stride = 1;
        this.playBufferWrites = 4;

        this.bufferWrites = 0;
        this.playing = false;

        this.port.onmessage = event => {
            if (!this.playing) {
                this.bufferWrites += 1;
                if (this.bufferWrites >= this.playBufferWrites) {
                    this.playing = true;
                }
            }

            const data = event.data;
            this.bytes.length = data.length * this.stride * this.playBufferWrites * 2;

            let a;
            for (let i = 0; i < data.length; i++) {
                for (a = 0; a < this.stride; a++) {
                    this.bytes[this.writeIndex] = data[i];
                    this.writeIndex = (this.writeIndex + 1) % this.bytes.length;
                }
            }
        };
    }

    process(inputs, outputs, parameters) {
        this.stride = parameters.stride[0];
        this.playBufferWrites = parameters.playBufferWrites[0];

        const output = outputs[0][0];
        if (!this.playing || !output) {
            return true;
        }

        for (let i = 0; i < output.length; i++) {
            output[i] = this.bytes[this.readIndex];
            this.readIndex = (this.readIndex + 1) % this.bytes.length;
        }

        return true;
    }

    static get parameterDescriptors() {
        // if stride is 2, and the expected output is 128 floats, you should provide 64 floats
        // stride duplicates floats
        return [
            {
                name: "stride",
                defaultValue: 1,
                minValue: 1,
                maxValue: 2,
            }, {
                name: "playBufferWrites",
                defaultValue: 4,
                minValue: 1,
                maxValue: 8,
            },
        ];
    }
}
  
registerProcessor('byte-writer-processor', ByteWriterProcessor);`;

const BYTE_READER_PROCESSOR = `
class ByteReaderProcessor extends AudioWorkletProcessor {
    bytes;

    constructor() {
        super();

        this.bytes = [];
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0][0];
        if (!input) {
            return true;
        }

        const stride = parameters.stride[0];

        this.bytes.length = input.length / stride;
        for (let i = 0; i < bytes.length; i++) {
            this.bytes[i] = input[i * stride];
        }
        this.port.postMessage(this.bytes);

        return true;
    }

    static get parameterDescriptors() {
        // if stride is 2, and the expected output is 128 floats, you should provide 64 floats
        // stride duplicates floats
        return [
            {
                name: "stride",
                defaultValue: 1,
                minValue: 1,
                maxValue: 2,
            },
        ];
    }
}
  
registerProcessor('byte-reader-processor', ByteReaderProcessor);`;

const BYTE_PITCH_SHIFTED_READER_PROCESSOR = `
class BytePitchShiftedReaderProcessor extends AudioWorkletProcessor {
    gInFIFO;
    gOutFIFO;
    gFFTworksp;
    gLastPhase;
    gSumPhase;
    gOutputAccum;
    gAnaFreq;
    gAnaMagn;
    gSynFreq;
    gSynMagn;
    gRover;
    gInit;
    gFrameLength;
    gOutput;
    s
    bufferedData;
    bufferedDataCount;
    outData;

    bytes;
    
    constructor() {
        super();
        
        // statics
        this.gRover = 0;
        this.gInit = false;
        this.gFrameLength = 128;

        this.bufferedData = [];
        this.bufferedDataCount = 0;
        this.outData = [];

        this.bytes = [];

        this.constructGlobalArrays();
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0][0];
        if (!input) {
            return true;
        }

        const pitchShift = parameters.pitchShift[0];
        const quality = parameters.quality[0];
        const sampleRate = parameters.sampleRate[0];
        const stride = parameters.stride[0];

        if (input.length !== this.gFrameLength) {
            this.gFrameLength = input.length;
            this.constructGlobalArrays();
        }

        this.bufferedData.length = input.length * 8;
        this.outData.length = input.length * 8;

        memcpy(this.bufferedData, this.bufferedDataCount, input, 0, input.length);
        this.bufferedDataCount += input.length;

        if (this.bufferedDataCount === this.bufferedData.length) {
            this.smbPitchShift(pitchShift, this.bufferedData.length, input.length, quality, sampleRate, this.bufferedData, this.outData);

            this.bytes.length = this.outData.length / stride;
            for (let i = 0; i < this.bytes.length; i++) {
                this.bytes[i] = this.outData[i * stride];
            }
            this.port.postMessage(this.bytes);

            this.bufferedDataCount = 0;
        }

        return true;
    }

    constructGlobalArrays() {
        console.log(this.gFrameLength);
        this.gInFIFO = new Array(this.gFrameLength);
        this.gOutFIFO = new Array(this.gFrameLength);
        this.gFFTworksp = new Array(2 * this.gFrameLength);
        this.gLastPhase = new Array(this.gFrameLength / 2 + 1);
        this.gSumPhase = new Array(this.gFrameLength / 2 + 1);
        this.gOutputAccum = new Array(2 * this.gFrameLength);
        this.gAnaFreq = new Array(this.gFrameLength);
        this.gAnaMagn = new Array(this.gFrameLength);
        this.gSynFreq = new Array(this.gFrameLength);
        this.gSynMagn = new Array(this.gFrameLength);
        this.gOutput = new Array(this.gFrameLength);
    }

    // osamp [4, 32]
    // sampleRate NSWA.context.sampleRate
    smbPitchShift(pitchShift, numSampsToProcess, fftFrameSize, osamp, sampleRate, indata, outdata) {
        // http://blogs.zynaptiq.com/bernsee

        let magn, phase, tmp, windo, real, imag = 0.0;
        let freqPerBin, expct = 0.0;
        let i, k, qpd, index, inFifoLatency, stepSize, fftFrameSize2 = 0;

        fftFrameSize2 = Math.floor(fftFrameSize / 2);
        stepSize = Math.floor(fftFrameSize / osamp);
        freqPerBin = sampleRate / fftFrameSize;
        expct = 2.0 * M_PI * stepSize / fftFrameSize;
        inFifoLatency = fftFrameSize - stepSize;
        if (!this.gRover) {
            this.gRover = inFifoLatency;
        }

        if (this.gInit === false) {
            memset(this.gInFIFO, 0);
            memset(this.gOutFIFO, 0);
            memset(this.gFFTworksp, 0);
            memset(this.gLastPhase, 0);
            memset(this.gSumPhase, 0);
            memset(this.gOutputAccum, 0);
            memset(this.gAnaFreq, 0);
            memset(this.gAnaMagn, 0);
            memset(this.gOutput, 0);
            this.gInit = true;
        }

        for (i = 0; i < numSampsToProcess; i++) {
            this.gInFIFO[this.gRover] = indata[i];
            outdata[i] = this.gOutFIFO[this.gRover - inFifoLatency];
            this.gRover++;

            if (this.gRover >= fftFrameSize) {
                this.gRover = inFifoLatency;

                for (k = 0; k < fftFrameSize; k++) {
                    windo = -0.5 * Math.cos(2.0 * M_PI * k / fftFrameSize) + 0.5;
                    this.gFFTworksp[2 * k] = this.gInFIFO[k] * windo;
                    this.gFFTworksp[2 * k + 1] = 0.0;
                }

                this.smbFft(this.gFFTworksp, fftFrameSize, -1);

                for (k = 0; k <= fftFrameSize2; k++) {
                    real = this.gFFTworksp[2 * k];
                    imag = this.gFFTworksp[2 * k + 1];

                    // compute magnitude and phase
                    magn = 2.0 * Math.sqrt(real * real + imag * imag);
                    phase = Math.atan2(imag, real);

                    // compute phase difference
                    tmp = phase - this.gLastPhase[k];
                    this.gLastPhase[k] = phase;

                    // subtract expected phase difference
                    tmp -= k * expct;

                    // map delta phase into +/- Pi interval
                    qpd = Math.floor(tmp / M_PI);
                    if (qpd >= 0) qpd += qpd & 1;
                    else qpd -= qpd & 1;
                    tmp -= M_PI * qpd;

                    // get deviation from bin frequency from the +/- Pi interval
                    tmp = osamp * tmp / (2.0 * M_PI);

                    // compute the k-th partials' true frequency
                    tmp = k * freqPerBin + tmp * freqPerBin;

                    // store magnitude and true frequency in analysis arrays
                    this.gAnaMagn[k] = magn;
                    this.gAnaFreq[k] = tmp;

                }

                // this does the actual pitch shifting
                memset(this.gSynMagn, 0);
                memset(this.gSynFreq, 0);
                for (k = 0; k <= fftFrameSize2; k++) { 
                    index = Math.floor(k * pitchShift);
                    if (index <= fftFrameSize2) { 
                        this.gSynMagn[index] += this.gAnaMagn[k]; 
                        this.gSynFreq[index] = this.gAnaFreq[k] * pitchShift; 
                    } 
                }
                
                // this is the synthesis step
                for (k = 0; k <= fftFrameSize2; k++) {

                    // get magnitude and true frequency from synthesis arrays
                    magn = this.gSynMagn[k];
                    tmp = this.gSynFreq[k];

                    // subtract bin mid frequency
                    tmp -= k * freqPerBin;

                    // get bin deviation from freq deviation
                    tmp /= freqPerBin;

                    // take osamp into account
                    tmp = 2.0 * M_PI * tmp / osamp;

                    // add the overlap phase advance back in
                    tmp += k * expct;

                    // accumulate delta phase to get bin phase
                    this.gSumPhase[k] += tmp;
                    phase = this.gSumPhase[k];

                    // get real and imag part and re-interleave
                    this.gFFTworksp[2 * k] = magn * Math.cos(phase);
                    this.gFFTworksp[2 * k + 1] = magn * Math.sin(phase);
                } 

                // zero negative frequencies
                for (k = fftFrameSize + 2; k < 2 * fftFrameSize; k++) this.gFFTworksp[k] = 0.0;

                // do inverse transform
                this.smbFft(this.gFFTworksp, fftFrameSize, 1);

                // do windoing and add to output accumulator 
                for(k = 0; k < fftFrameSize; k++) {
                    windo = -0.5 * Math.cos(2.0 * M_PI * k / fftFrameSize) + 0.5;
                    this.gOutputAccum[k] += 2.0 * windo * this.gFFTworksp[2 * k] / (fftFrameSize2 * osamp);
                }
                for (k = 0; k < stepSize; k++) this.gOutFIFO[k] = this.gOutputAccum[k];

                // shift accumulator
                memcpy(this.gOutputAccum, 0, this.gOutputAccum, stepSize, fftFrameSize);

                // move input FIFO
                for (k = 0; k < inFifoLatency; k++) this.gInFIFO[k] = this.gInFIFO[k + stepSize];
            }
        }
    };

    smbFft(fftBuffer, fftFrameSize, sign) {
        // http://blogs.zynaptiq.com/bernsee

        let wr, wi, arg, temp = 0.0;
        let p1, p2 = 0; // these are indices now
        let tr, ti, ur, ui = 0.0;
        let p1r, p1i, p2r, p2i = 0; // these are indices now
        let i, bitm, j, le, le2, k = 0;

        for (i = 2; i < 2 * fftFrameSize - 2; i += 2) {
            for (bitm = 2, j = 0; bitm < 2 * fftFrameSize; bitm <<= 1) {
                if (i & bitm) j++;
                j <<= 1;
            }
            if (i < j) {
                p1 = i; p2 = j;
                temp = fftBuffer[p1]; fftBuffer[(p1++)] = fftBuffer[p2];
                fftBuffer[(p2++)] = temp; temp = fftBuffer[p1];
                fftBuffer[p1] = fftBuffer[p2]; fftBuffer[p2] = temp;
            }
        }
        for (k = 0, le = 2; k < Math.floor(Math.log(fftFrameSize) / Math.log(2.0) + 0.5); k++) {
            le <<= 1;
            le2 = le>>1;
            ur = 1.0;
            ui = 0.0;
            arg = M_PI / (le2>>1);
            wr = Math.cos(arg);
            wi = sign * Math.sin(arg);
            for (j = 0; j < le2; j += 2) {
                p1r = j; p1i = p1r + 1;
                p2r = p1r + le2; p2i = p2r + 1;
                for (i = j; i < 2 * fftFrameSize; i += le) {
                    tr = fftBuffer[p2r] * ur - fftBuffer[p2i] * ui;
                    ti = fftBuffer[p2r] * ui + fftBuffer[p2i] * ur;
                    fftBuffer[p2r] = fftBuffer[p1r] - tr; fftBuffer[p2i] = fftBuffer[p1i] - ti;
                    fftBuffer[p1r] += tr; fftBuffer[p1i] += ti;
                    p1r += le; p1i += le;
                    p2r += le; p2i += le;
                }
                tr = ur * wr - ui * wi;
                ui = ur * wi + ui * wr;
                ur = tr;
            }
        }
    }

    static get parameterDescriptors() {
        return [
            {
                name: "stride",
                defaultValue: 1,
                minValue: 1,
                maxValue: 2,
            }, {
                name: "pitchShift",
                defaultValue: 1,
                minValue: 0,
                maxValue: 2,
            }, {
                name: "quality",
                defaultValue: 32,
                minValue: 4,
                maxValue: 32,
            }, {
                name: "sampleRate",
                defaultValue: 48000,
                minValue: 0,
                maxValue: 96000,
            },
        ];
    }
}

const MAX_FRAME_LENGTH = 8192;
const M_PI = Math.PI;

const memset = (arr, value) => {
    arr.fill(value);
}

const memcpy = (dest, destOffset, src, srcOffset, elementCount) => {
    for (let i = 0; i < elementCount; i++) {
        dest[destOffset + i] = src[srcOffset + i];
    }
};
  
registerProcessor('byte-pitch-shifted-reader-processor', BytePitchShiftedReaderProcessor);
`;

const BASS_TREBLE_PROCESSOR = `
class BassTrebleProcessor extends AudioWorkletProcessor {
    bassData;

    samplerate;
    slope;
    hzBass;
    hzTreble;
    a0Bass;
    a1Bass;
    a2Bass;
    b0Bass;
    b1Bass;
    b2Bass;
    a0Treble;
    a1Treble;
    a2Treble;
    b0Treble;
    b1Treble;
    b2Treble;
    xn1Bass;
    xn2Bass;
    yn1Bass;
    yn2Bass;
    xn1Treble;
    xn2Treble;
    yn1Treble;
    yn2Treble;
    bass;
    treble;
    gain;

    constructor() {
        super();
        
        // bass boost
        this.samplerate = 0;
        this.slope = 0.4; // same slope for both filter,
        this.hzBass = 250.0; // could be tunable in a more advanced version,
        this.hzTreble = 4000.0; // could be tunable in a more advanced version,
    
        this.a0Bass = 1;
        this.a1Bass = 0;
        this.a2Bass = 0;
        this.b0Bass = 0;
        this.b1Bass = 0;
        this.b2Bass = 0;
    
        this.a0Treble = 1;
        this.a1Treble = 0;
        this.a2Treble = 0;
        this.b0Treble = 0;
        this.b1Treble = 0;
        this.b2Treble = 0;
    
        this.xn1Bass = 0;
        this.xn2Bass = 0;
        this.yn1Bass = 0;
        this.yn2Bass = 0;
    
        this.xn1Treble = 0;
        this.xn2Treble = 0;
        this.yn1Treble = 0;
        this.yn2Treble = 0;
    
        this.bass = -1;
        this.treble = -1;
        this.gain = 1;
    }

    process(inputs, outputs, parameters) {
        const bassGain = parameters.bassGain[0];
        const trebleGain = parameters.trebleGain[0];
        const gain = parameters.gain[0];
        const sampleRate = parameters.sampleRate[0];

        this.calculateBassCoefficients(bassGain, trebleGain, gain, sampleRate);

        const sourceCount = Math.min(inputs.length, outputs.length);
        for (let i = 0; i < sourceCount; i++) {
            const inputChannels = inputs[i];
            const outputChannels = outputs[i];
            const channelCount = Math.min(inputChannels.length, outputChannels.length);

            for (let a = 0; a < channelCount; a++) {
                const inputValues = inputChannels[a];
                const outputValues = outputChannels[a];

                // copy(inputValues, outputValues);

                this.bassBoost(inputValues, outputValues);
            }
        }

        return true;
    }

    calculateBassCoefficients(bassBoostDB, trebleBoostDB, boostDB, sampleRate) {
        const bassBoost = DB_TO_LINEAR(bassBoostDB);
        const trebleBoost = DB_TO_LINEAR(trebleBoostDB);
        const gain = DB_TO_LINEAR(boostDB);
        if (bassBoost !== this.bass || trebleBoost !== this.treble || gain !== this.gain || sampleRate !== this.samplerate) {
            this.bass = bassBoost;
            this.treble = trebleBoost;
            this.gain = gain;
            this.samplerate = sampleRate;
        
            this.bassCoefficients(bassBoostDB, trebleBoostDB);
        }
    };
    
    bassBoost(buffer, outBuffer) {
        for (let i = 0; i < buffer.length; i++) {
            // Bass filter
            let input = buffer[i];
            let out = (this.b0Bass * input + this.b1Bass * this.xn1Bass + this.b2Bass * this.xn2Bass -
                this.a1Bass * this.yn1Bass - this.a2Bass * this.yn2Bass) / this.a0Bass;
            this.xn2Bass = this.xn1Bass;
            this.xn1Bass = input;
            this.yn2Bass = this.yn1Bass;
            this.yn1Bass = out;
    
            // Treble filter
            input = out;
            out = (this.b0Treble * input + this.b1Treble * this.xn1Treble + this.b2Treble * this.xn2Treble -
                this.a1Treble * this.yn1Treble - this.a2Treble * this.yn2Treble) / this.a0Treble;
            this.xn2Treble = this.xn1Treble;
            this.xn1Treble = input;
            this.yn2Treble = this.yn1Treble;
            this.yn1Treble = out;
    
            outBuffer[i] = out * this.gain;
        }
    };
    
    bassCoefficients(bassBoostDB, trebleBoostDB) {
        let wb = 2 * Math.PI * this.hzBass / this.samplerate;
        let ab = Math.exp(Math.log(10.0) * bassBoostDB / 40);
        let bb = Math.sqrt((ab * ab + 1) / this.slope - (Math.pow((ab - 1), 2)));
    
        this.b0Bass = ab * ((ab + 1) - (ab - 1) * Math.cos(wb) + bb * Math.sin(wb));
        this.b1Bass = 2 * ab * ((ab - 1) - (ab + 1) * Math.cos(wb));
        this.b2Bass = ab * ((ab + 1) - (ab - 1) * Math.cos(wb) - bb * Math.sin(wb));
        this.a0Bass = ((ab + 1) + (ab - 1) * Math.cos(wb) + bb * Math.sin(wb));
        this.a1Bass = -2 * ((ab - 1) + (ab + 1) * Math.cos(wb));
        this.a2Bass = (ab + 1) + (ab - 1) * Math.cos(wb) - bb * Math.sin(wb);
    
        let wt = 2 * Math.PI * this.hzTreble / this.samplerate;
        let at = Math.exp(Math.log(10.0) * trebleBoostDB / 40);
        let bt = Math.sqrt((at * at + 1) / this.slope - (Math.pow((at - 1), 2)));
    
        this.b0Treble = at * ((at + 1) + (at - 1) * Math.cos(wt) + bt * Math.sin(wt));
        this.b1Treble = -2 * at * ((at - 1) + (at + 1) * Math.cos(wt));
        this.b2Treble = at * ((at + 1) + (at - 1) * Math.cos(wt) - bt * Math.sin(wt));
        this.a0Treble = ((at + 1) - (at - 1) * Math.cos(wt) + bt * Math.sin(wt));
        this.a1Treble = 2 * ((at - 1) - (at + 1) * Math.cos(wt));
        this.a2Treble = (at + 1) - (at - 1) * Math.cos(wt) - bt * Math.sin(wt);
    }

    static get parameterDescriptors() {
        return [
            {
                name: "bassGain",
                defaultValue: 0,
                minValue: -100,
                maxValue: 100,
            }, {
                name: "trebleGain",
                defaultValue: 0,
                minValue: -100,
                maxValue: 100,
            }, {
                name: "gain",
                defaultValue: 0,
                minValue: -100,
                maxValue: 100,
            }, {
                name: "sampleRate",
                defaultValue: 48000,
                minValue: 0,
                maxValue: 96000,
            },
        ];
    }
}

const DB_TO_LINEAR = (x) => {
    return Math.pow(10.0, x / 20.0);
};

const LINEAR_TO_DB = (x) => {
    return 20.0 * Math.log10(x);
};
  
registerProcessor('bass-treble-processor', BassTrebleProcessor);
`;
