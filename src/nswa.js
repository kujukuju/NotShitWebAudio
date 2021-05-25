class SourceInstance {
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

    _connectedBuffer;

    _source;
    _bufferInstance;

    _playing;
    _sourceLoadedCallback;

    _gainNode;
    _pannerNode;

    _playbackRate;

    _lastRateChangeTime;
    _previousAccumulatedTime;

    constructor(source) {
        this._connectedBuffer = false;

        this._source = source;
        this._bufferInstance = null;

        this._playing = false;
        this._sourceLoadedCallback = null;

        this._gainNode = NSWA.context.createGain();
        this._pannerNode = null;
        this._playbackRate = 1;

        this._lastRateChangeTime = 0;
        this._previousAccumulatedTime = 0;

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
            this._bufferInstance.stop();
        }

        if (this._connectedBuffer) {
            this._disconnect();
        }

        return this;
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

        this._pannerNode.positionX.value = x;
        this._pannerNode.positionY.value = y;
        this._pannerNode.positionZ.value = z;

        return this;
    }

    setPannerOrientation(x, y, z) {
        if (!this._pannerNode) {
            this._createPannerNode();
        }

        this._pannerNode.orientationX.value = x;
        this._pannerNode.orientationY.value = y;
        this._pannerNode.orientationZ.value = z;

        return this;
    }

    removePanner() {
        if (!this._pannerNode) {
            return this;
        }

        this._pannerNode.disconnect();
        this._pannerNode = null;

        this._gainNode.disconnect();
        this._gainNode.connect(NSWA.destination);

        return this;
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

    setVolume(volume) {
        this._gainNode.gain.setValueAtTime(volume, NSWA.context.currentTime);

        return this;
    }

    destroy() {
        // delete listeners and stop the audio
        // stop auto deletes the listeners if there are any
        this.stop();
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
        this._bufferInstance.start(0, this.getCurrentTime());
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
            this._gainNode.disconnect();
            this._gainNode.connect(this._pannerNode);
            this._pannerNode.connect(NSWA.destination);
        }
    }

    _connect() {
        if (this._connectedBuffer) {
            return;
        }

        if (!this._source.isReady()) {
            return;
        }

        this._connectedBuffer = true;
        this._bufferInstance = NSWA.context.createBufferSource();
        this._bufferInstance.buffer = this._source.getAudioBuffer();
        this._bufferInstance.playbackRate.value = this._playbackRate;

        // TODO do I have to branch this out logarithmically for it to not clip?
        this._bufferInstance.connect(this._gainNode);
        if (this._pannerNode) {
            this._gainNode.connect(this._pannerNode);
            this._pannerNode.connect(NSWA.destination);
        } else {
            this._gainNode.connect(NSWA.destination);
        }
    }

    _disconnect() {
        if (!this._connectedBuffer) {
            return;
        }
        this._connectedBuffer = false;

        this._bufferInstance.disconnect();
        this._gainNode.disconnect();
        if (this._pannerNode) {
            this._pannerNode.disconnect();
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

class Source {
    static LISTENER_READY = 0;

    _ready;
    _loaded;
    _contextRunning;

    _audioBuffer;

    _listeners;

    _volume;

    constructor(src, options) {
        this._ready = false;
        this._loaded = false;
        this._volume = options.volume ?? 1;
        this._contextRunning = NSWA.context.state === 'running';
        if (!this._contextRunning) {
            NSWA._requestContextResume(this._onchangeContextState.bind(this));
        }

        this._audioBuffer = null;

        this._listeners = {};

        const response = fetch(src);
        response.then(this._onloadResult.bind(this));
    }

    isReady() {
        return this._ready;
    }

    getAudioBuffer() {
        return this._audioBuffer;
    }

    getVolume() {
        return this._volume;
    }

    setVolume(volume) {
        this._volume = volume;
    }

    getDuration() {
        if (!this._audioBuffer) {
            return 0;
        }

        return this._audioBuffer.duration;
    }

    create() {
        return new SourceInstance(this);
    }

    destroy() {
        throw 'I don\'t yet have a neeed to destroy audio sources.';
    }

    addEventListener(event, callback) {
        switch (event) {
            case Source.LISTENER_READY: {
                this._addReadyListener(callback);
            } break;

            default:
                console.error('Received unknown listener type.', event);
        }
    }

    removeEventListener(event, callback) {
        if (!this._listeners[event]) {
            return;
        }

        const index = this._listeners[event].indexOf(callback);
        if (index === -1) {
            return;
        }

        NSWA._removeArray(this._listeners[event], index);

        if (this._listeners[event].length === 0) {
            delete this._listeners[event];
        }
    }

    _addReadyListener(callback) {
        // precheck
        if (this._ready) {
            callback();
            return;
        }

        // add the listener
        if (!this._listeners[Source.LISTENER_READY]) {
            this._listeners[Source.LISTENER_READY] = [];
        }

        this._listeners[Source.LISTENER_READY].push(callback);
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

    _checkReady() {
        const ready = this._loaded && this._contextRunning;
        if (this._ready || !ready) {
            return;
        }
        this._ready = true;

        const listeners = this._listeners[Source.LISTENER_READY];
        for (let i = 0; i < listeners.length; i++) {
            listeners[i]();
        }
    }

    _onchangeContextState() {
        if (NSWA.context.state !== 'running') {
            return;
        }
        this._contextRunning = true;

        this._checkReady();
    }
}

const NSWA = {
    context: new (window.AudioContext ?? window.webAudioContext)(),
    destination: null,
    Source,
    setListenerOrientation: function(forwardX, forwardY, forwardZ, upX, upY, upZ) {
        NSWA.context.listener.forwardX = forwardX;
        NSWA.context.listener.forwardY = forwardY;
        NSWA.context.listener.forwardZ = forwardZ;
        NSWA.context.listener.upX = upX;
        NSWA.context.listener.upY = upY;
        NSWA.context.listener.upZ = upZ;
    },
    setListenerPosition: function(x, y, z) {
        NSWA.context.listener.positionX = x;
        NSWA.context.listener.positionY = y;
        NSWA.context.listener.positionZ = z;
    },
    setVolume(volume) {
        NSWA.destination.gain.setValueAtTime(volume, NSWA.context.currentTime);
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
            NSWA._requestContextResume();
        }
    },
    _inputListener: function() {
        NSWA.context.resume();
    },
    _requestContextResume: function(callback) {
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
    }
};

NSWA.destination = NSWA.context.createGain();
NSWA.destination.connect(NSWA.context.destination);

if (NSWA.context.state !== 'running') {
    NSWA._requestContextResume();
}