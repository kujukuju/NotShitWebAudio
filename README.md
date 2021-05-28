## Not Shit Web Audio

A very simple web audio library designed for games that does pretty much all you'll need in a performance and memory focused way.

See the source code for the documentation.

### Performance and garbage collection notes

Web audio is very not performant. Each node in the graph adds performance issues, and once you reach a certain performance level, dependent on device, you will start to hear audio stutter.

Other libraries make this problem worse by over complicating the audio node graph, having unnecessary event queues, or just being written in non-garbage collection friendly ways. 

This library keeps the graph as simple as possible until you've issued certain events that require a more complicated graph to be constructed. For example, individual audio instances do not have a corresponding gain node until you specifically require it.

The other problem of almost all javascript libraries is the absolute zero thought put into garbage collection. This is a big issue when trying to make even minorly complicated but performant web games. The ability to reuse memory and not create excessive anonymous functions or arrays is an absolute requirement. Currently this library does a much better job of managing memory/garbage collection, but it could still be slightly improved. 

### Upkeep notes

I don't plan to really support this library more than I need for my own purposes. Right now it seems to work perfectly for my minimal use case, and it's probably more than sufficient for 80% of game audio requirements.

The library is essentially a state machine that constructs/deconstructs the very simple node graph based on what the user has specified by their function calls.

If I am to expand this library I'll likely expand it into automatically constructing node based objects, and these node based objects would automatically resolve the state machine to allow the users to manually specify any audio node graph they desire.

### Example code

```javascript
const PLAY_NOT_SEEK = true;

// you can set the global volume of all audio by accessing the library methods
NSWA.setVolume(0.5);

// construct a source to automatically load from a file
const source = new NSWA.Source('/test/cinematic-music.mp3');

// by default an instance is the most optimal simple web audio node, with no unnecessary connections
const instance = source.create();
// by setting the volume, even to 1, we initialize the creation of a gain (volume) node
instance.setVolume(1);
// by setting the panner position, or any panner property, we initialize the creation of a panner (3d audio) node
// it's fine to do this rapidly, probably even every frame
instance.setPannerPosition(1, 0, 0);

// if you have 3d audio, you will also need to update the global position and orientation of the listener
// it's also fine to do this rapidly, probably even every frame
NSWA.setListenerOrientation(1, 0, 0, 0, 1, 0);
NSWA.setListenerPosition(0, 0, 0);

if (PLAY_NOT_SEEK) {
    // if you want to play, calling play() will start the audio instance from 0
    instance.play();
} else {
    // if you want to seek to a specific point, calling seek(1.5) will skip to 1.5 seconds into the audio clip
    // as a performance note, seek will first stop any existing audio, then reconstruct the
    // node (which is relatively efficient) starting at the specified time
    // as such, calling play then seek is redundant and unnecessary
    instance.seek(1.5);
}

// this library also handles rate updating nicely. if you call setRate(0.5) the audio will play at 50% speed
instance.setRate(0.5);
// and a corresponding call to getCurrentTime() will return the current seconds into the current audio clip, while
// respecting every rate update call you've done up to this point
const time = instance.getCurrentTime();

// calling instance.stop() will deconstruct the node so you can release your reference
instance.stop();

if (PLAY_NOT_SEEK) {
    // it's also perfectly fine to call play again after deconstructing the node
    instance.play();
} else {
    // or seek
    instance.seek(time);
}
```