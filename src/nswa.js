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
        this._loop = source.getLoop();

        this._lastRateChangeTime = 0;
        this._previousAccumulatedTime = 0;

        this._listeners = {};
        this._onceListeners = {};

        this._extraNodes = [];

        const sourceVolume = source.getVolume();
        if (sourceVolume !== 1) {
            this.setVolume(sourceVolume);
        }

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

        if (this._source.isReady() && !this._connectedBuffer) {
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

        const previousNode = this._getPreviousNode(this._pannerNode);
        const nextNode = this._getNextNode(this._pannerNode);

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
        for (let i = 0; i < this._extraNodes.length; i++) {
            if (this._extraNodes[i] === node) {
                return this;
            }
        }

        this._extraNodes.push(node);

        if (this._connectedBuffer) {
            const previous = this._getPreviousNode(node);
            const next = this._getNextNode(node);
            previous.disconnect();
            previous.connect(node);
            node.connect(next);
        }

        return this;
    }

    removeExtraNode(node) {
        let removedNode = false;
        let previousNode = this._getPreviousNode(node);
        let nextNode = this._getNextNode(node);
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

        node.disconnect();
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
            const previous = this._getPreviousNode(this._pannerNode);
            const next = this._getNextNode(this._pannerNode);
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
            const previous = this._getPreviousNode(this._gainNode);
            const next = this._getNextNode(this._gainNode);
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
            if (this._extraNodes.length > 0) {
                return this._extraNodes[this._extraNodes.length - 1];
            } else if (this._gainNode) {
                return this._gainNode;
            }

            return this._bufferInstance;
        } else if (node === NSWA.destination) {
            if (this._pannerNode) {
                return this._pannerNode;
            } else if (this._extraNodes.length > 0) {
                return this._extraNodes[this._extraNodes.length - 1];
            } else if (this._gainNode) {
                return this._gainNode;
            }

            return this._bufferInstance;
        } else if (this._extraNodes.length > 0) {
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
            } else if (this._extraNodes.length > 0) {
                return this._extraNodes[0];
            } else if (this._pannerNode) {
                return this._pannerNode;
            }

            return NSWA.destination;
        } else if (node === this._gainNode) {
            if (this._extraNodes.length > 0) {
                return this._extraNodes[0];
            }
            if (this._pannerNode) {
                return this._pannerNode;
            }

            return NSWA.destination;
        } else if (node === this._pannerNode) {
            return NSWA.destination;
        } else if (this._extraNodes.length > 0) {
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

        if (!this._source.isReady()) {
            return;
        }

        this._connectedBuffer = true;
        this._bufferInstance = this._source.createNode();
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
            currentNode.connect(nextNode);
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
            previousNode.disconnect();
            previousNode = this._getPreviousNode(previousNode);
        }

        this._bufferInstance = null;
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

class SourceBase {
    static LISTENER_READY = 0;

    _ready;
    _loaded;
    _contextRunning;

    _audioBuffer;

    _listeners;
    _onceListeners;

    _path;
    _volume;

    constructor(path, options) {
        this._ready = false;
        this._loaded = false;
        this._path = path;
        this._volume = options?.volume ?? 1;

        this._contextRunning = NSWA.context.state === 'running';
        if (!this._contextRunning) {
            NSWA.requestContextResume(this._onchangeContextState.bind(this));
        }

        this._audioBuffer = null;

        this._listeners = {};
        this._onceListeners = {};
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

    constructor(path, name, options) {
        super(path, options);

        this._name = name;

        if (Script._loadedNames[name]) {
            this._onloadResult();
        } else {
            if (Script._loadingNameCallbacks[name]) {
                Script._loadingNameCallbacks[name].push(() => {
                    this._onloadResult();
                });
            } else {
                Script._loadingNameCallbacks[name] = [];

                const response = NSWA.context.audioWorklet.addModule(path);
                response.then(this._onloadResult.bind(this));
            }
        }
    }

    createNode() {
        return new AudioWorkletNode(NSWA.context, this._name);
    }

    _onloadResult() {
        this._loaded = true;

        if (!Script._loadedNames[this._name]) {
            Script._loadedNames[this._name] = true;

            const callbacks = Script._loadingNameCallbacks[this._name];
            delete Script._loadingNameCallbacks[this._name];

            for (let i = 0; i < callbacks.length; i++) {
                callbacks[i]();
            }
        }

        this._checkReady();
    }
}

class NodeBase {
    constructor() {
        
    }
}

const NSWA = {
    context: new (window.AudioContext ?? window.webAudioContext)(),
    destination: null,
    Script,
    Source,
    setListenerOrientation: function(forwardX, forwardY, forwardZ, upX, upY, upZ) {
        // NSWA.context.listener.forwardX.setTargetAtTime(forwardX, NSWA.context.currentTime, 0.1);
        // NSWA.context.listener.forwardY.setTargetAtTime(forwardY, NSWA.context.currentTime, 0.1);
        // NSWA.context.listener.forwardZ.setTargetAtTime(forwardZ, NSWA.context.currentTime, 0.1);
        NSWA.context.listener.forwardX.linearRampToValueAtTime(forwardX, NSWA.context.currentTime + 0.05);
        NSWA.context.listener.forwardY.linearRampToValueAtTime(forwardY, NSWA.context.currentTime + 0.05);
        NSWA.context.listener.forwardZ.linearRampToValueAtTime(forwardZ, NSWA.context.currentTime + 0.05);
        NSWA.context.listener.upX.linearRampToValueAtTime(upX, NSWA.context.currentTime + 0.05);
        NSWA.context.listener.upY.linearRampToValueAtTime(upY, NSWA.context.currentTime + 0.05);
        NSWA.context.listener.upZ.linearRampToValueAtTime(upZ, NSWA.context.currentTime + 0.05);
    },
    setListenerPosition: function(x, y, z) {
        // NSWA.context.listener.positionX.setValueAtTime(x, NSWA.context.currentTime);
        // NSWA.context.listener.positionY.setValueAtTime(y, NSWA.context.currentTime);
        // NSWA.context.listener.positionZ.setValueAtTime(z, NSWA.context.currentTime);
        NSWA.context.listener.positionX.linearRampToValueAtTime(x, NSWA.context.currentTime + 0.05);
        NSWA.context.listener.positionY.linearRampToValueAtTime(y, NSWA.context.currentTime + 0.05);
        NSWA.context.listener.positionZ.linearRampToValueAtTime(z, NSWA.context.currentTime + 0.05);
        // NSWA.context.listener.positionX.value = x;
        // NSWA.context.listener.positionY.value = y;
        // NSWA.context.listener.positionZ.value = z;
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
        const blob = new Blob([script]);
        return new URL.createObjectURL(blob);
    },
    _createWorklet: function(url, name) {

    }
};

// NSWA.context.audioWorklet.addModule('libs/nswamerger.js').then(result => {
//     console.log('finished?');
//     NSWA.destination = new AudioWorkletNode(NSWA.context, 'merger-processor');
//
//     NSWA.destination.connect(NSWA.context.destination);
//     console.log(NSWA.destination);
// }).catch(error => {
//     console.error('Could not load merger node.', error);
// });



NSWA.destination = NSWA.context.createGain();
NSWA.destination.connect(NSWA.context.destination);
// NSWA.destination = NSWA.context.createDynamicsCompressor();
// NSWA.destination.threshold.value = -12;
// NSWA.destination.knee.value = 30;
// NSWA.destination.ratio.value = 24;
// NSWA.destination.attack.value = 0;
// NSWA.destination.release.value = 0;

if (NSWA.context.state !== 'running') {
    NSWA.requestContextResume();
}