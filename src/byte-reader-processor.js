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
  
registerProcessor('byte-reader-processor', ByteReaderProcessor);