NSWA.setListenerOrientation(0, 0, -1, 0, 1, 0);
NSWA.setListenerPosition(0, 0, 0);

const source = new NSWA.Source('/test/cinematic-music.mp3');
const instance = source.create();
instance.setVolume(1);
instance.setPannerAttributes({});
instance.play();

NSWA.setVolume(0.2);

let angle = 0;
setInterval(() => {
    angle += 0.02;

    const direction = [Math.cos(angle), 0, Math.sin(angle)];
    const position = [direction[0] * 100, 0, direction[2] * 100];
    instance.setPannerOrientation(-direction[0], -direction[1], -direction[2]);
    instance.setPannerPosition(position[0], position[1], position[2]);
}, 30);

// setTimeout(() => {
//     instance.setRate(0.5);
// }, 4000);

// let desiredOffset = 0;
// setInterval(() => {
//     desiredOffset += 2;
//     console.log(instance.getTime(), desiredOffset);
//     const time = instance.getTime() + desiredOffset;
//
//     instance.seek(time);
// }, 2000);

// setInterval(() => {
//     instance.setRate(Math.random() * 0.2 + 0.9);
//
//     setTimeout(() => {
//         instance.seek(instance.getCurrentTime());
//     }, 1000);
// }, 2000);