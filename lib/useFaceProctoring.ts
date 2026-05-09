"use client";

import { useEffect, useRef, useState, type RefObject } from "react";

export type CameraViolationType =
  | "absent"
  | "multiple_faces"
  | "looking_away"
  | "not_centered"
  | "not_facing_camera"
  | "possible_device";
export type ProctoringStatus = "idle" | "loading" | "ok" | "alert";
export type DetectorBackend = "face-api" | "unavailable";

export type VisualConfidenceSample = {
  timestamp: number;
  faceVisible: boolean;
  detectionScore: number;
  centeredScore: number;
  facingScore: number;
  eyeContactScore: number;
  postureScore: number;
  confidenceScore: number;
  violationType?: CameraViolationType | "none";
};

type Options = {
  videoRef: RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  onViolation: (type: CameraViolationType) => void;
  onSample?: (sample: VisualConfidenceSample) => void;
};

type FaceApi = {
  nets: {
    tinyFaceDetector: { loadFromUri: (uri: string) => Promise<void>; isLoaded: boolean };
    faceLandmark68TinyNet: { loadFromUri: (uri: string) => Promise<void>; isLoaded: boolean };
  };
  TinyFaceDetectorOptions: new (options: { inputSize: number; scoreThreshold: number }) => unknown;
  detectAllFaces: (input: HTMLVideoElement, options: unknown) => {
    withFaceLandmarks: (useTinyModel?: boolean) => Promise<FaceDetection[]>;
  };
};

type FaceDetection = {
  detection: {
    score: number;
    box: { x: number; y: number; width: number; height: number };
  };
  landmarks?: {
    getLeftEye: () => Point[];
    getRightEye: () => Point[];
    getNose: () => Point[];
    getMouth: () => Point[];
  };
};

type Point = { x: number; y: number };

declare global {
  interface Window {
    faceapi?: FaceApi;
  }
}

const MODEL_URL = "/models";
const CHECK_INTERVAL_MS = 1200;
const WARNING_COOLDOWN_MS = 9000;
const REQUIRED_HITS = 2;

const LABELS: Record<CameraViolationType, string> = {
  absent: "Face not visible",
  multiple_faces: "Multiple faces detected",
  looking_away: "Please face the camera",
  not_centered: "Please center your face",
  not_facing_camera: "Please face the camera",
  possible_device: "Possible phone/device detected",
};

const PRIORITY: CameraViolationType[] = [
  "multiple_faces",
  "absent",
  "not_facing_camera",
  "looking_away",
  "not_centered",
  "possible_device",
];

function average(points: Point[]) {
  return points.reduce(
    (acc, p) => ({ x: acc.x + p.x / points.length, y: acc.y + p.y / points.length }),
    { x: 0, y: 0 }
  );
}

function waitForFaceApi(cancelled: () => boolean): Promise<FaceApi> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      if (cancelled()) return reject(new Error("cancelled"));
      if (window.faceapi) return resolve(window.faceapi);
      if (Date.now() - started > 8000) return reject(new Error("face-api unavailable"));
      window.setTimeout(tick, 100);
    };
    tick();
  });
}

function chooseViolation(video: HTMLVideoElement, detections: FaceDetection[]): CameraViolationType | null {
  if (detections.length === 0) return "absent";
  if (detections.length > 1) return "multiple_faces";

  const { box } = detections[0].detection;
  const width = video.videoWidth || video.clientWidth || 1;
  const height = video.videoHeight || video.clientHeight || 1;
  const faceCenterX = box.x + box.width / 2;
  const faceCenterY = box.y + box.height / 2;
  const xOffset = Math.abs(faceCenterX / width - 0.5);
  const yOffset = Math.abs(faceCenterY / height - 0.48);
  const faceAreaRatio = (box.width * box.height) / (width * height);

  if (xOffset > 0.22 || yOffset > 0.25 || faceAreaRatio < 0.045) return "not_centered";

  const landmarks = detections[0].landmarks;
  if (!landmarks) return null;

  const leftEye = average(landmarks.getLeftEye());
  const rightEye = average(landmarks.getRightEye());
  const nose = average(landmarks.getNose());
  const mouth = average(landmarks.getMouth());
  const eyeCenter = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
  const eyeDistance = Math.max(1, Math.abs(rightEye.x - leftEye.x));
  const noseYaw = (nose.x - eyeCenter.x) / eyeDistance;
  const noseDrop = (nose.y - eyeCenter.y) / Math.max(1, mouth.y - eyeCenter.y);
  const leftEyeToNose = Math.abs(nose.x - leftEye.x);
  const rightEyeToNose = Math.abs(rightEye.x - nose.x);
  const eyeBalance = Math.min(leftEyeToNose, rightEyeToNose) / Math.max(leftEyeToNose, rightEyeToNose, 1);

  if (Math.abs(noseYaw) > 0.34 || eyeBalance < 0.45) return "not_facing_camera";
  if (noseDrop > 0.78 || noseDrop < 0.25) return "looking_away";
  if (noseDrop > 0.7 && faceCenterY / height > 0.56) return "possible_device";

  return null;
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreFromDeviation(value: number, ideal: number, maxDeviation: number) {
  return clampScore(100 - (Math.abs(value - ideal) / maxDeviation) * 100);
}

function buildVisualConfidenceSample(
  video: HTMLVideoElement,
  detections: FaceDetection[],
  violationType: CameraViolationType | null
): VisualConfidenceSample {
  const timestamp = Date.now();
  if (detections.length !== 1) {
    return {
      timestamp,
      faceVisible: false,
      detectionScore: 0,
      centeredScore: 0,
      facingScore: 0,
      eyeContactScore: 0,
      postureScore: 0,
      confidenceScore: 0,
      violationType: violationType || "none",
    };
  }

  const { detection, landmarks } = detections[0];
  const { box } = detection;
  const width = video.videoWidth || video.clientWidth || 1;
  const height = video.videoHeight || video.clientHeight || 1;
  const faceCenterX = box.x + box.width / 2;
  const faceCenterY = box.y + box.height / 2;
  const xOffset = Math.abs(faceCenterX / width - 0.5);
  const yOffset = Math.abs(faceCenterY / height - 0.48);
  const faceAreaRatio = (box.width * box.height) / (width * height);

  const detectionScore = clampScore(detection.score * 100);
  const centeredScore = clampScore(100 - Math.max(xOffset / 0.26, yOffset / 0.28) * 100);
  const postureScore = clampScore(
    (scoreFromDeviation(faceCenterY / height, 0.5, 0.28) * 0.55) +
    (scoreFromDeviation(faceAreaRatio, 0.14, 0.12) * 0.45)
  );

  let facingScore = centeredScore;
  let eyeContactScore = centeredScore;

  if (landmarks) {
    const leftEye = average(landmarks.getLeftEye());
    const rightEye = average(landmarks.getRightEye());
    const nose = average(landmarks.getNose());
    const mouth = average(landmarks.getMouth());
    const eyeCenter = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 };
    const eyeDistance = Math.max(1, Math.abs(rightEye.x - leftEye.x));
    const noseYaw = (nose.x - eyeCenter.x) / eyeDistance;
    const noseDrop = (nose.y - eyeCenter.y) / Math.max(1, mouth.y - eyeCenter.y);
    const leftEyeToNose = Math.abs(nose.x - leftEye.x);
    const rightEyeToNose = Math.abs(rightEye.x - nose.x);
    const eyeBalance = Math.min(leftEyeToNose, rightEyeToNose) / Math.max(leftEyeToNose, rightEyeToNose, 1);

    facingScore = clampScore(
      scoreFromDeviation(noseYaw, 0, 0.38) * 0.55 +
      clampScore(eyeBalance * 100) * 0.45
    );
    eyeContactScore = clampScore(
      scoreFromDeviation(noseYaw, 0, 0.32) * 0.45 +
      scoreFromDeviation(noseDrop, 0.52, 0.32) * 0.35 +
      centeredScore * 0.2
    );
  }

  const confidenceScore = clampScore(
    detectionScore * 0.15 +
    centeredScore * 0.2 +
    facingScore * 0.25 +
    eyeContactScore * 0.25 +
    postureScore * 0.15
  );

  return {
    timestamp,
    faceVisible: true,
    detectionScore,
    centeredScore,
    facingScore,
    eyeContactScore,
    postureScore,
    confidenceScore,
    violationType: violationType || "none",
  };
}

export function useFaceProctoring({ videoRef, enabled, onViolation, onSample }: Options) {
  const [status, setStatus] = useState<ProctoringStatus>("idle");
  const [label, setLabel] = useState("Monitoring");
  const [mode, setMode] = useState<DetectorBackend>("unavailable");
  const countersRef = useRef<Record<CameraViolationType, number>>({
    absent: 0,
    multiple_faces: 0,
    looking_away: 0,
    not_centered: 0,
    not_facing_camera: 0,
    possible_device: 0,
  });
  const lastWarningRef = useRef<Record<CameraViolationType, number>>({
    absent: 0,
    multiple_faces: 0,
    looking_away: 0,
    not_centered: 0,
    not_facing_camera: 0,
    possible_device: 0,
  });
  const runningRef = useRef(false);
  const onViolationRef = useRef(onViolation);
  const onSampleRef = useRef(onSample);

  useEffect(() => {
    onViolationRef.current = onViolation;
  }, [onViolation]);

  useEffect(() => {
    onSampleRef.current = onSample;
  }, [onSample]);

  useEffect(() => {
    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;
    let busy = false;

    async function start() {
      if (!enabled) {
        setStatus("idle");
        setLabel("Monitoring");
        return;
      }

      setStatus("loading");
      setLabel("Starting local proctoring");

      try {
        const faceapi = await waitForFaceApi(() => cancelled);
        if (!faceapi.nets.tinyFaceDetector.isLoaded) {
          await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);
        }
        if (!faceapi.nets.faceLandmark68TinyNet.isLoaded) {
          await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL);
        }

        if (cancelled) return;
        setMode("face-api");
        setStatus("ok");
        setLabel("All clear");
        runningRef.current = true;

        const options = new faceapi.TinyFaceDetectorOptions({
          inputSize: 224,
          scoreThreshold: 0.5,
        });

        interval = setInterval(async () => {
          const video = videoRef.current;
          if (!video || video.readyState < 2 || busy) return;

          busy = true;
          try {
            const detections = await faceapi.detectAllFaces(video, options).withFaceLandmarks(true);
            const current = chooseViolation(video, detections);
            onSampleRef.current?.(buildVisualConfidenceSample(video, detections, current));
            const now = Date.now();

            for (const type of PRIORITY) {
              countersRef.current[type] = current === type ? countersRef.current[type] + 1 : 0;
            }

            if (current && countersRef.current[current] >= REQUIRED_HITS) {
              setStatus("alert");
              setLabel(LABELS[current]);
              if (now - lastWarningRef.current[current] > WARNING_COOLDOWN_MS) {
                lastWarningRef.current[current] = now;
                onViolationRef.current(current);
              }
            } else if (!current && runningRef.current) {
              setStatus("ok");
              setLabel("All clear");
            }
          } catch (error) {
            console.warn("[FaceProctor] detection failed:", error);
          } finally {
            busy = false;
          }
        }, CHECK_INTERVAL_MS);
      } catch (error) {
        if (!cancelled) {
          console.warn("[FaceProctor] unavailable:", error);
          setMode("unavailable");
          setStatus("alert");
          setLabel("Local proctor unavailable");
        }
      }
    }

    start();

    return () => {
      cancelled = true;
      runningRef.current = false;
      if (interval) clearInterval(interval);
    };
  }, [enabled, videoRef]);

  const setAlert = (msg: string) => {
    setStatus("alert");
    setLabel(msg);
  };
  const setOk = () => {
    setStatus("ok");
    setLabel("All clear");
  };

  return { status, label, mode, setAlert, setOk };
}
