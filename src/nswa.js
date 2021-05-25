class SourceInstance {
    _connectedBuffer;
    _playTime;

    _source;
    _bufferInstance;

    _playing;
    _sourceLoadedCallback;

    _gainNode;
    _playbackRate;

    _lastRateChangeTime;
    _previousAccumulatedTime;

    constructor(source) {
        this._connectedBuffer = false;
        this._playTime = 0;

        this._source = source;
        this._bufferInstance = null;

        this._playing = false;
        this._sourceLoadedCallback = null;

        this._gainNode = NSWA.context.createGain();
        this._playbackRate = 1;

        this._lastRateChangeTime = 0;
        this._previousAccumulatedTime = 0;

        if (this._source.isReady()) {
            this._connect();
        }
    }

    play(offset) {
        if (this._playTime) {
            return;
        }
        this._playTime = Date.now() - (offset ?? 0) * 1000;

        if (this._source.isReady() && !this._connectedBuffer) {
            this._connect();
        }

        if (this._connectedBuffer) {
            this._play();
        } else if (!this._connectedBuffer && !this._sourceLoadedCallback) {
            this._sourceLoadedCallback = this._onSourceLoaded.bind(this);

            this._source.addEventListener(Source.LISTENER_READY, this._sourceLoadedCallback);
        }
    }

    stop() {
        this._playTime = 0;

        if (this._sourceLoadedCallback) {
            this._source.removeListener(Source.LISTENER_READY, this._sourceLoadedCallback);
            this._sourceLoadedCallback = null;
        }

        if (this._playing) {
            this._playing = false;
            this._bufferInstance.stop();

            this._disconnect();
        }
    }

    getCurrentTime() {
        if (this._playTime === 0) {
            return 0;
        }

        // TODO incorrect because it doesn't consider the sample rate
        return (Date.now() - this._playTime) / 1000.0;
    }

    seek(time) {
        this.stop();

        this.play(time);
    }

    getRate() {
        return this._playbackRate;
    }

    setRate(rate) {
        this._playbackRate = rate;

        if (this._bufferInstance) {
            this._bufferInstance.playbackRate.value = rate;
        }
    }

    setVolume(volume) {
        this._gainNode.gain.setValueAtTime(volume, NSWA.context.currentTime);
    }

    destroy() {
        // delete listeners
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
        this._bufferInstance.start(0, (Date.now() - this._playTime) / 1000.0);
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
        this._gainNode.connect(NSWA.context.destination);
    }

    _disconnect() {
        if (!this._connectedBuffer) {
            return;
        }
        this._connectedBuffer = false;

        this._bufferInstance.disconnect();
        this._gainNode.disconnect();

        this._bufferInstance = null;
    }

    _onSourceLoaded() {
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

    constructor(src, options) {
        this._ready = false;
        this._loaded = false;
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

    removeListener(event, callback) {
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
    Source,
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

if (NSWA.context.state !== 'running') {
    NSWA._requestContextResume();
}

const source = new NSWA.Source('/test/cinematic-music.mp3');
const instance = source.create();
instance.setVolume(0.2);
instance.play();

setTimeout(() => {
    instance.setRate(0.5);
}, 4000);

// let desiredOffset = 0;
// setInterval(() => {
//     desiredOffset += 2;
//     console.log(instance.getTime(), desiredOffset);
//     const time = instance.getTime() + desiredOffset;
//
//     instance.seek(time);
// }, 2000);