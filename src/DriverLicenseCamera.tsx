import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions, type PictureRef } from 'expo-camera';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { decode } from 'jpeg-js';
import { hasFramedLicense, licenseFrame } from './LicenseFraming';

function deleteTemporaryPhoto(uri: string) {
  try { new File(uri).delete(); } catch { /* The camera cache may already have removed it. */ }
}

export function DriverLicenseCamera({ onClose, onPhoto }: {
  onClose: () => void;
  onPhoto: (photo: { uri: string; fileName: string; mimeType: string }) => Promise<void>;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraReady, setCameraReady] = useState(false);
  const [framed, setFramed] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [error, setError] = useState('');
  const camera = useRef<CameraView>(null);
  const capturingRef = useRef(false);
  const sampling = useRef(false);
  const alignedAt = useRef(0);
  const previewRatio = useRef(3 / 4);

  useEffect(() => {
    const listener = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      setForeground(active);
      if (!active) {
        alignedAt.current = 0;
        setFramed(false);
        setCameraReady(false);
      }
    });
    return () => listener.remove();
  }, []);

  async function checkPicture(picture: PictureRef) {
    const context = ImageManipulator.manipulate(picture);
    try {
      const frame = await context.resize({ width: 240 }).renderAsync();
      try {
        const thumbnail = await frame.saveAsync({ base64: true, format: SaveFormat.JPEG, compress: 0.8 });
        try {
          if (!thumbnail.base64) return false;
          const jpg = Uint8Array.from(atob(thumbnail.base64), (char) => char.charCodeAt(0));
          return hasFramedLicense(decode(jpg, { useTArray: true }), previewRatio.current);
        } finally {
          deleteTemporaryPhoto(thumbnail.uri);
        }
      } finally {
        frame.release();
      }
    } finally {
      context.release();
    }
  }

  useEffect(() => {
    if (!cameraReady || !permission?.granted || !foreground || capturing) return;
    let active = true;
    let confirmedFrames = 0;
    let timer: ReturnType<typeof setTimeout>;
    async function scan() {
      try {
        if (!camera.current || capturingRef.current || sampling.current) return;
        sampling.current = true;
        let aligned = false;
        try {
          const picture = await camera.current.takePictureAsync({ pictureRef: true, shutterSound: false });
          if (picture) {
            try { if (active) aligned = await checkPicture(picture); }
            finally { picture.release(); }
          }
        } catch {
          aligned = false;
        } finally {
          sampling.current = false;
        }
        if (!active) return;
        confirmedFrames = aligned ? confirmedFrames + 1 : 0;
        alignedAt.current = aligned ? Date.now() : 0;
        setFramed(confirmedFrames >= 2);
      } finally {
        if (active) timer = setTimeout(() => void scan(), 700);
      }
    }
    void scan();
    return () => { active = false; clearTimeout(timer); };
  }, [cameraReady, permission?.granted, foreground, capturing]);

  async function takePhoto() {
    if (!camera.current || capturingRef.current || sampling.current || !framed || Date.now() - alignedAt.current > 2500) return;
    capturingRef.current = true;
    setCapturing(true);
    setError('');
    try {
      const picture = await camera.current.takePictureAsync({ pictureRef: true, shutterSound: false });
      if (!picture) return;
      try {
        if (!await checkPicture(picture)) {
          alignedAt.current = 0;
          setFramed(false);
          setError('A CNH saiu da moldura. Enquadre novamente.');
          return;
        }
        const photo = await picture.savePictureAsync({ quality: 0.75 });
        try {
          await onPhoto({ uri: photo.uri, fileName: 'cnh.jpg', mimeType: 'image/jpeg' });
        } finally {
          deleteTemporaryPhoto(photo.uri);
        }
      } finally {
        picture.release();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível tirar a foto.');
    } finally {
      capturingRef.current = false;
      setCapturing(false);
    }
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>Fotografar CNH</Text>
        <Pressable accessibilityRole="button" onPress={onClose} disabled={capturing} style={styles.button}>
          <Text style={styles.buttonText}>Cancelar</Text>
        </Pressable>
      </View>
      {permission?.granted ? <>
        <Text style={styles.text}>Coloque a CNH deitada sobre um fundo contrastante, com os quatro lados dentro da moldura.</Text>
        <View style={styles.preview} onLayout={({ nativeEvent }) => {
          const { width, height } = nativeEvent.layout;
          if (height > 0) previewRatio.current = width / height;
        }}>
          {foreground && <CameraView ref={camera} facing="back" ratio="4:3" animateShutter={false}
            style={StyleSheet.absoluteFill} onCameraReady={() => setCameraReady(true)}
            onMountError={() => setError('Não foi possível abrir a câmera.')} />}
          <View pointerEvents="none" style={[styles.frame, framed && styles.alignedFrame]} />
        </View>
        <Text accessibilityLiveRegion="polite" style={styles.text}>
          {framed ? 'CNH enquadrada' : 'Ajuste a posição até a moldura ficar verde'}
        </Text>
        <Pressable accessibilityRole="button" disabled={!framed || capturing} onPress={() => void takePhoto()}
          style={[styles.button, (!framed || capturing) && styles.disabled]}>
          <Text style={styles.buttonText}>{capturing ? 'Processando…' : 'Tirar foto'}</Text>
        </Pressable>
      </> : <>
        <Text style={styles.text}>Permita o acesso à câmera para fotografar a CNH.</Text>
        {permission?.canAskAgain && <Pressable accessibilityRole="button" style={styles.button}
          onPress={() => void requestPermission().catch(() => setError('Não foi possível solicitar acesso à câmera.'))}>
          <Text style={styles.buttonText}>Permitir câmera</Text>
        </Pressable>}
        {permission && !permission.canAskAgain && <Text style={styles.text}>Você pode permitir a câmera nas configurações do aparelho ou enviar uma foto da galeria.</Text>}
      </>}
      {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, padding: 16, gap: 12, backgroundColor: '#111827' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  title: { color: '#fff', fontSize: 20, fontWeight: '700' },
  text: { color: '#fff', textAlign: 'center' },
  preview: { aspectRatio: 3 / 4, flexShrink: 1, minHeight: 100, width: '100%', maxWidth: 350,
    alignSelf: 'center', overflow: 'hidden', borderRadius: 12, backgroundColor: '#000' },
  frame: { position: 'absolute', left: `${licenseFrame.left * 100}%`, right: `${(1 - licenseFrame.right) * 100}%`,
    top: `${licenseFrame.top * 100}%`, bottom: `${(1 - licenseFrame.bottom) * 100}%`,
    borderWidth: 3, borderColor: '#fff', borderRadius: 8 },
  alignedFrame: { borderColor: '#4ade80' },
  button: { padding: 12, backgroundColor: '#155bc7', borderRadius: 8, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.5 },
  error: { color: '#fecaca', textAlign: 'center' },
});
