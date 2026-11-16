// Speech-to-text worker. The audio never leaves the device; only the
// Whisper model files are downloaded (once, then cached by the browser).
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1';

env.allowLocalModels = false;

let asr = null;
let loadedModel = null;

self.onmessage = async (e) => {
  const { audio, model, language } = e.data;
  try {
    if (loadedModel !== model) {
      asr = await pipeline('automatic-speech-recognition', model, {
        dtype: 'q8',
        progress_callback: (p) => {
          if (p.status === 'progress') {
            self.postMessage({ type: 'download', file: p.file, progress: p.progress });
          }
        },
      });
      loadedModel = model;
    }
    self.postMessage({ type: 'stage' });
    const out = await asr(audio, {
      language,
      task: 'transcribe',
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    self.postMessage({ type: 'done', chunks: out.chunks || [] });
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err && err.message) || err) });
  }
};
