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