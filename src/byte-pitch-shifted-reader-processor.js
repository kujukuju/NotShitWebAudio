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