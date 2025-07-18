# ArUco 3D Tracker (Ionic + React + Three.js + Capacitor + Vite)

This project is a mobile-friendly web app for **real-time ArUco marker 3D tracking** using a phone camera, built with **Ionic React**, **Three.js**, **Capacitor**, and **Vite**. It communicates with a Python backend (WebSocket server) for marker detection.

---

## Features

- Uses phone camera (via Capacitor Camera Preview plugin)
- Real-time ArUco marker detection and 3D pose visualization (Three.js)
- WebSocket communication with Python backend
- Mobile-first UI with Ionic components
- HTTPS development support (with self-signed certificates)
- Works on Android emulator and real devices

---

## Getting Started

### 1. Clone the Repository

```sh
git clone <your-repo-url>
cd <project-folder>
```

### 2. Install Dependencies

```sh
npm install
```

### 3. Generate SSL Certificates (for HTTPS dev)

You can use **OpenSSL**:

```sh
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes"
```

Or use [mkcert](https://github.com/FiloSottile/mkcert) for a trusted local CA.

### 4. Start the Vite Dev Server

```sh
npm run dev
```

- The dev server will use HTTPS and your generated certificates.
- Make sure `vite.config.ts` has:
  ```ts
  server: {
    https: {
      key: fs.readFileSync('./key.pem'),
      cert: fs.readFileSync('./cert.pem'),
    },
  }
  ```

### 5. Access from Android Emulator

- Open the browser in the emulator and go to:  
  `https://<server_ip>:5173`
- If you see a certificate warning, install your cert as a trusted CA on the emulator.

---

## Python Backend (WebSocket Server)

- Start your Python server with SSL enabled and listening on all interfaces:
  ```sh
  python scripts/aruco_websocket_server.py --host 0.0.0.0 --port 8765 --cert cert.pem --key key.pem
  ```
- Make sure the WebSocket URL in your React app matches the server address and protocol (e.g., `wss://<server_ip>:8765`).

---

## Camera Preview (Capacitor Plugin)

- This project uses [`@capacitor-community/camera-preview`](https://github.com/capacitor-community/camera-preview).
- To run on a real device or emulator:
  ```sh
  npx cap sync
  npx cap open android
  ```
- Build and run from Android Studio.

---

## Troubleshooting

- **WebSocket connection errors:**  
  - Ensure server is running and accessible at the correct address.
  - Use `wss://<server_ip>:8765` for emulator, or your LAN IP for real device.
  - Make sure your SSL cert is trusted by the emulator/device.
- **Camera not working:**  
  - Make sure you have granted camera permissions.
  - Only works on real devices or emulators with camera support.

---

## Project Structure

```
src/
  components/
    ArUco3DTracker.tsx
  ...
vite.config.ts
key.pem
cert.pem
```

---

## License

MIT

---

## Credits

- [Ionic Framework](https://ionicframework.com/)
- [React](https://react.dev/)
- [Three.js](https://threejs.org/)
- [@capacitor-community/camera-preview](https://github.com/capacitor-community/camera-preview)
- [Vite](https://vitejs.dev/)