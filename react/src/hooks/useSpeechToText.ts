/**
 * useSpeechToText
 * ===============
 *
 * React hook that captures microphone audio via `MediaRecorder`, uploads
 * it to the same-origin agenticChat controller (`?action=speech_transcribe`),
 * and surfaces the Whisper transcription back to the caller.
 *
 * Mirrors the behaviour of the equivalent hook in the base `sh-shp-llm`
 * plugin so editors can rely on the same UX (auto-stop on silence,
 * MIME-type negotiation, language detection) across both chat surfaces.
 *
 * @module hooks/useSpeechToText
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_RECORDING_DURATION_MS = 60_000;
const SILENCE_THRESHOLD = 0.01;
const SILENCE_DURATION_MS = 2000;
const SILENCE_CHECK_INTERVAL_MS = 150;

const PREFERRED_AUDIO_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
];

const MIC_CONSTRAINTS_FALLBACKS: MediaStreamConstraints[] = [
  {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 24000 },
    },
  },
  {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
    },
  },
  { audio: true },
];

/** Options accepted by the useSpeechToText hook. */
export interface UseSpeechToTextOptions {
  /** When false the hook reports `isAvailable: false` and never records. */
  enabled: boolean;
  /** Whisper model identifier (only used for diagnostics; the server picks too). */
  model: string;
  /** CMS section id sent with every upload (controller validates it). */
  sectionId: number;
  /** Same-origin URL of the section controller (POST target for the upload). */
  controllerUrl: string;
  /** Invoked with the transcribed text once processing completes. */
  onTranscription: (text: string) => void;
}

/** Surface returned by the hook to the calling component. */
export interface UseSpeechToTextReturn {
  /** True when the browser supports recording AND the feature is enabled. */
  isAvailable: boolean;
  /** True while the microphone is actively recording. */
  isRecording: boolean;
  /** True between recording stop and transcription completion. */
  isProcessing: boolean;
  /** Human-readable error or null. */
  error: string | null;
  /** Reset the error state. */
  clearError: () => void;
  /** Begin recording (asks for permission on first call). */
  startRecording: () => Promise<void>;
  /** Stop recording and trigger upload + transcription. */
  stopRecording: () => void;
  /** Toggle: starts if idle, stops if recording. */
  toggleRecording: () => void;
}

function getPreferredAudioMimeType(): string {
  for (const mime of PREFERRED_AUDIO_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return '';
}

function mimeToExtension(mimeType: string): string {
  const base = mimeType.split(';')[0].trim().toLowerCase();
  if (base === 'audio/mp4') return 'm4a';
  if (base === 'audio/ogg') return 'ogg';
  return 'webm';
}

async function requestMicrophoneStream(): Promise<MediaStream> {
  let lastError: unknown = null;

  for (const constraints of MIC_CONSTRAINTS_FALLBACKS) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
      const name = err instanceof DOMException ? err.name : '';
      if (name !== 'OverconstrainedError' && name !== 'NotFoundError') {
        throw err;
      }
    }
  }

  throw lastError || new Error('No supported microphone constraints');
}

/**
 * Speech-to-text pipeline hook (record -> upload -> transcription).
 */
export function useSpeechToText({
  enabled,
  sectionId,
  controllerUrl,
  onTranscription,
}: UseSpeechToTextOptions): UseSpeechToTextReturn {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const silenceStartRef = useRef<number>(0);
  const hasSpokenRef = useRef(false);

  const onTranscriptionRef = useRef(onTranscription);
  useEffect(() => {
    onTranscriptionRef.current = onTranscription;
  }, [onTranscription]);

  const isAvailable =
    enabled &&
    typeof MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function';

  const stopSilenceDetection = useCallback(() => {
    if (silenceTimerRef.current) {
      clearInterval(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
      analyserRef.current = null;
    }
  }, []);

  const cleanupMediaStream = useCallback(() => {
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((t) => t.stop());
      audioStreamRef.current = null;
    }
  }, []);

  const clearRecordingTimeout = useCallback(() => {
    if (recordingTimeoutRef.current) {
      clearTimeout(recordingTimeoutRef.current);
      recordingTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopSilenceDetection();
      cleanupMediaStream();
      clearRecordingTimeout();
    };
  }, [stopSilenceDetection, cleanupMediaStream, clearRecordingTimeout]);

  const processAudioBlob = useCallback(
    async (audioBlob: Blob, mimeType: string) => {
      if (audioBlob.size === 0) {
        setError('No audio recorded');
        return;
      }

      setIsProcessing(true);
      setError(null);

      try {
        const extension = mimeToExtension(mimeType);
        const formData = new FormData();
        formData.append('audio', audioBlob, `recording.${extension}`);
        formData.append('action', 'speech_transcribe');
        formData.append('section_id', String(sectionId));

        const response = await fetch(controllerUrl, {
          method: 'POST',
          credentials: 'same-origin',
          body: formData,
        });

        const result = await response.json();

        if (result.success && result.text) {
          const text = String(result.text).trim();
          if (text) {
            onTranscriptionRef.current(text);
          }
        } else if (result.success && !result.text) {
          setError('No speech detected. Please try again.');
        } else {
          setError(result.error || 'Speech transcription failed');
        }
      } catch (err: unknown) {
        console.error('Speech processing error:', err);
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError('Speech processing failed: ' + msg);
      } finally {
        setIsProcessing(false);
      }
    },
    [controllerUrl, sectionId],
  );

  const stopRecording = useCallback(() => {
    stopSilenceDetection();
    clearRecordingTimeout();

    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;

    if (recorder?.state === 'recording') {
      recorder.stop();
    }

    cleanupMediaStream();
    setIsRecording(false);
  }, [cleanupMediaStream, clearRecordingTimeout, stopSilenceDetection]);

  const startSilenceDetection = useCallback(
    (stream: MediaStream) => {
      try {
        const ctx = new (window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext!)();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        source.connect(analyser);

        audioContextRef.current = ctx;
        analyserRef.current = analyser;
        silenceStartRef.current = 0;
        hasSpokenRef.current = false;

        const dataArray = new Float32Array(analyser.fftSize);

        silenceTimerRef.current = setInterval(() => {
          if (!analyserRef.current) return;
          analyserRef.current.getFloatTimeDomainData(dataArray);

          let rms = 0;
          for (let i = 0; i < dataArray.length; i++) {
            rms += dataArray[i] * dataArray[i];
          }
          rms = Math.sqrt(rms / dataArray.length);

          if (rms > SILENCE_THRESHOLD) {
            hasSpokenRef.current = true;
            silenceStartRef.current = 0;
          } else if (hasSpokenRef.current) {
            if (silenceStartRef.current === 0) {
              silenceStartRef.current = Date.now();
            } else if (Date.now() - silenceStartRef.current >= SILENCE_DURATION_MS) {
              stopRecording();
            }
          }
        }, SILENCE_CHECK_INTERVAL_MS);
      } catch {
        // Silence detection not available — user stops manually.
      }
    },
    [stopRecording],
  );

  const startRecording = useCallback(async () => {
    if (!isAvailable || isRecording || isProcessing) return;

    setError(null);

    try {
      const mimeType = getPreferredAudioMimeType();
      if (!mimeType) {
        setError('No supported compressed audio format available.');
        return;
      }

      const stream = await requestMicrophoneStream();

      audioStreamRef.current = stream;
      audioChunksRef.current = [];

      const recorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 16000,
      });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        if (audioChunksRef.current.length > 0) {
          const blob = new Blob(audioChunksRef.current, { type: mimeType });
          await processAudioBlob(blob, mimeType);
        }
        audioChunksRef.current = [];
      };

      recorder.start(250);
      setIsRecording(true);

      startSilenceDetection(stream);

      recordingTimeoutRef.current = setTimeout(() => {
        if (mediaRecorderRef.current?.state === 'recording') {
          stopRecording();
        }
      }, MAX_RECORDING_DURATION_MS);
    } catch (err: unknown) {
      console.error('Failed to start recording:', err);
      const msg = err instanceof Error ? err.message : 'Unknown error';

      if (msg.includes('Permission denied') || msg.includes('NotAllowedError')) {
        setError('Microphone access denied. Please allow microphone access in your browser settings.');
      } else if (msg.includes('OverconstrainedError')) {
        setError('Microphone constraints not supported on this device.');
      } else {
        setError('Failed to start recording: ' + msg);
      }
    }
  }, [isAvailable, isRecording, isProcessing, processAudioBlob, startSilenceDetection, stopRecording]);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      void startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  const clearError = useCallback(() => setError(null), []);

  return {
    isAvailable,
    isRecording,
    isProcessing,
    error,
    clearError,
    startRecording,
    stopRecording,
    toggleRecording,
  };
}
