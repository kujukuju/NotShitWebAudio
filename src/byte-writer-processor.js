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
        this.playBufferWrites = parameters.writePlayBuffer[0];

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
  
registerProcessor('byte-writer-processor', ByteWriterProcessor);