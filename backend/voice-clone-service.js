const DEFAULT_UPLOAD_ENDPOINT = "https://api.minimaxi.com/v1/files/upload";
const DEFAULT_CLONE_ENDPOINT = "https://api.minimaxi.com/v1/voice_clone";
const DEFAULT_MODEL = "speech-2.8-hd";

class VoiceCloneService {
  constructor() {
    this.apiKey = process.env.MINIMAX_API_KEY || "";
    this.uploadEndpoint = process.env.MINIMAX_FILE_UPLOAD_ENDPOINT || DEFAULT_UPLOAD_ENDPOINT;
    this.cloneEndpoint = process.env.MINIMAX_VOICE_CLONE_ENDPOINT || DEFAULT_CLONE_ENDPOINT;
    this.model = process.env.MINIMAX_VOICE_CLONE_MODEL || DEFAULT_MODEL;
  }

  getStatus() {
    return {
      configured: Boolean(this.apiKey),
      provider: "minimax",
      upload_endpoint: this.uploadEndpoint,
      clone_endpoint: this.cloneEndpoint,
      model: this.model,
      required_env: this.apiKey ? [] : ["MINIMAX_API_KEY"],
      notes: [
        "voice_clone audio must be mp3/m4a/wav, 10 seconds to 5 minutes, <=20MB",
        "cloned voice_id is deleted if unused for 7 days",
      ],
    };
  }
}

module.exports = {
  VoiceCloneService,
};
