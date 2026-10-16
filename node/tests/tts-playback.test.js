const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const html = fs.readFileSync(path.join(__dirname, "../public/control-panel.html"), "utf8");
const playback = html.slice(html.indexOf("const TTS_PLAYBACK_QUEUE_LIMIT"), html.indexOf("function copyAllLogs()"));
const flush = () => new Promise(resolve => setTimeout(resolve, 10));

function setup() {
  const sources = [], fetched = [], legacy = [], logs = [];
  const frames = new Float32Array([0.25, -0.5, 0.125]);
  const state = { now: 1000, fetchOverride: null, decodeOverride: null };
  const context = {
    state: "running", destination: {},
    decodeAudioData: async () => {
      if (state.decodeOverride) await state.decodeOverride();
      return { numberOfChannels: 1, length: frames.length, sampleRate: 8000, getChannelData: () => frames };
    },
    createBuffer: (channels, length, sampleRate) => {
      const data = new Float32Array(length);
      return { length, sampleRate, data, copyToChannel: (input, channel, offset) => data.set(input, offset) };
    },
    createBufferSource: () => {
      const source = { connect() {}, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; } };
      sources.push(source);
      return source;
    },
  };
  const sandbox = vm.createContext({
    connectAudioContext: context, AbortController, setTimeout, clearTimeout,
    Date: { now: () => state.now }, unlockAudio() {},
    addLog: event => logs.push(event),
    fetch: async (url, options) => {
      fetched.push(url);
      if (state.fetchOverride) return state.fetchOverride(url, options);
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
    },
    Audio: class {
      constructor(url) { this.url = url; legacy.push(this); }
      play() { this.played = true; return Promise.resolve(); }
      pause() { this.paused = true; }
    },
  });
  vm.runInContext(playback, sandbox);
  return { sandbox, sources, fetched, legacy, logs, state, frames,
    run: code => vm.runInContext(code, sandbox) };
}

test("buffered voice preserves every speech sample at unity volume after local lead-in", async () => {
  const s = setup();
  s.run("playTikPlayAudio('/tts-audio/1/eleven_abc.mp3','chat',false)");
  await flush();
  assert.equal(s.sources.length, 1);
  const source = s.sources[0], leadIn = 4000;
  assert.equal(source.started, true);
  assert.equal(source.buffer.length, s.frames.length + leadIn);
  assert.ok(source.buffer.data.slice(0, leadIn).every(value => value === 0));
  assert.deepEqual(source.buffer.data.slice(leadIn), s.frames);
  assert.equal(s.legacy.length, 0);
  s.run("clearChatNarrationPlayback()");
  assert.equal(source.stopped, true);
  assert.equal(s.run("ttsPlaybackActive"), false);
});

test("cancellation while downloading cannot start a stale voice", async () => {
  const s = setup();
  let release;
  s.state.fetchOverride = () => new Promise(resolve => { release = resolve; });
  s.run("playTikPlayAudio('/tts-audio/1/eleven_abc.mp3','chat',false)");
  s.run("clearChatNarrationPlayback()");
  release({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  await flush();
  assert.equal(s.sources.length, 0);
  assert.equal(s.run("ttsPlaybackActive"), false);
});

test("expired voice after decoding is discarded without playback", async () => {
  const s = setup();
  s.state.decodeOverride = async () => { s.state.now = 2000; };
  s.run("playTikPlayAudio('/tts-audio/1/eleven_abc.mp3','chat',false,false,100)");
  await flush();
  assert.equal(s.sources.length, 0);
  assert.equal(s.run("ttsPlaybackActive"), false);
});

test("existing queue remains serial and prioritizes voice tests", async () => {
  const s = setup();
  s.run("playTikPlayAudio('/tts-audio/1/eleven_abc.mp3','chat',false); playTikPlayAudio('/tts-audio/1/eleven_def.mp3','chat',false); playTikPlayAudio('/tts-audio/1/eleven_123.mp3','tts',false,true)");
  await flush();
  assert.equal(s.sources.length, 1);
  s.sources[0].onended();
  await flush();
  assert.equal(s.fetched[1], "/tts-audio/1/eleven_123.mp3");
  s.sources[1].onended();
  await flush();
  assert.equal(s.fetched[2], "/tts-audio/1/eleven_def.mp3");
  s.run("clearChatNarrationPlayback()");
});

test("standard voice keeps existing playback at full volume and remains cancellable", async () => {
  const s = setup();
  s.run("playTikPlayAudio('/tts-audio/1/edge_test.mp3','chat',false)");
  assert.equal(s.legacy[0].played, true);
  assert.equal(s.legacy[0].volume, 1);
  assert.equal(s.legacy[0].muted, false);
  s.run("clearChatNarrationPlayback()");
  assert.equal(s.legacy[0].paused, true);
});
