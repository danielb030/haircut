"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { CameraPreview } from '@capacitor-community/camera-preview'
import { IonPage, IonContent, IonCard, IonCardHeader, IonCardTitle, IonCardContent, IonButton, IonBadge, IonSpinner, IonGrid, IonRow, IonCol, IonIcon, IonAlert } from '@ionic/react';
import * as THREE from "three"

// ArUco detection types
interface ArUcoMarker {
  id: number
  corners: number[][]
  center: { x: number; y: number }
}

interface MarkerPose {
  position: THREE.Vector3
  rotation: THREE.Euler
  scale: number
  confidence: number
}

interface DetectionStats {
  fps: number
  markersDetected: number
  totalDetections: number
  avgLatency: number
  connectionStatus: "connected" | "disconnected" | "connecting"
  trackedMarkerId: number | null
}

// Three.js Scene Manager
class ThreeJSSceneManager {
  private scene: THREE.Scene
  private camera: THREE.PerspectiveCamera
  private renderer: THREE.WebGLRenderer
  private controls: any // OrbitControls
  private trackedPlane: THREE.Group | null = null
  private planeMesh: THREE.Mesh | null = null
  private wireframeMesh: THREE.Mesh | null = null
  private textSprite: THREE.Sprite | null = null
  private coordinateAxes: THREE.Group | null = null
  private animationId: number | null = null
  private targetPose: MarkerPose | null = null
  private currentPose: MarkerPose | null = null

  constructor(container: HTMLElement) {
    // Remove any existing canvas (prevents duplicate renderers)
    // alert("Initializing Three.js scene manager..")
    const oldCanvas = container.querySelector("canvas");
    if (oldCanvas) {
      container.removeChild(oldCanvas);
    }
    // Initialize scene
    console.log("Initializing Three.js scene...")
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x1a1a1a)

    // Initialize camera
    this.camera = new THREE.PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 1000)
    this.camera.position.set(5, 5, 5)
    this.camera.lookAt(0, 0, 0)

    // Initialize renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true})
    this.renderer.setSize(container.clientWidth, container.clientHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    console.log("Renderer initialized with antialiasing and shadow maps enabled")
    container.appendChild(this.renderer.domElement)


    // Setup scene
    this.setupLighting()
    this.setupGrid()
    this.setupReferenceObjects()

    // Initialize controls
    this.initializeControls()
    this.startAnimation()
    // Handle resize
    setInterval(() => {
      const width = container.clientWidth
      const height = container.clientHeight

      this.camera.aspect = width / height
      this.camera.updateProjectionMatrix()
      this.renderer.setSize(width, height)
    }, 1000);
    window.addEventListener("resize", this.handleResize.bind(this))
  }

  private async initializeControls() {
    try {
      // Dynamically import 
      console.log("Loading OrbitControls...")
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js")
      this.controls = new OrbitControls(this.camera, this.renderer.domElement)
      this.controls.enableDamping = true
      this.controls.dampingFactor = 0.05
      this.controls.minDistance = 3
      this.controls.maxDistance = 100
      this.controls.target.set(0, 0, 0)
    } catch (error) {
      console.error("Failed to load OrbitControls:", error)
    }
  }

  private setupLighting() {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    this.scene.add(ambientLight)

    // Directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(10, 10, 5)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.width = 2048
    directionalLight.shadow.mapSize.height = 2048
    directionalLight.shadow.camera.near = 0.5
    directionalLight.shadow.camera.far = 50
    this.scene.add(directionalLight)

    // Point light
    const pointLight = new THREE.PointLight(0xffffff, 0.4)
    pointLight.position.set(-10, -10, -5)
    this.scene.add(pointLight)
  }

  private setupGrid() {
    // Ground grid
    const gridHelper = new THREE.GridHelper(20, 20, 0x9d4b4b, 0x6f6f6f)
    gridHelper.position.y = -2
    this.scene.add(gridHelper)

    // Ground plane for shadows
    const groundGeometry = new THREE.PlaneGeometry(20, 20)
    const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x333333, transparent: true, opacity: 0.3 })
    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial)
    groundMesh.rotation.x = -Math.PI / 2
    groundMesh.position.y = -2
    groundMesh.receiveShadow = true
    this.scene.add(groundMesh)
  }

  private setupReferenceObjects() {
    // Reference cubes
    const cubeGeometry = new THREE.BoxGeometry(0.5, 0.5, 0.5)

    // Blue cube
    const blueMaterial = new THREE.MeshStandardMaterial({ color: 0x4444ff })
    const blueCube = new THREE.Mesh(cubeGeometry, blueMaterial)
    blueCube.position.set(-3, 0, 0)
    blueCube.castShadow = true
    this.scene.add(blueCube)

    // Red cube
    const redMaterial = new THREE.MeshStandardMaterial({ color: 0xff4444 })
    const redCube = new THREE.Mesh(cubeGeometry, redMaterial)
    redCube.position.set(3, 0, 0)
    redCube.castShadow = true
    this.scene.add(redCube)
  }

  private createTrackedPlane(markerId: number) {
    // Remove existing plane
    
    if (this.trackedPlane) {
      this.scene.remove(this.trackedPlane)
    }

    // Create new plane group
    this.trackedPlane = new THREE.Group()

    // Main plane
    const planeGeometry = new THREE.PlaneGeometry(2, 1.5)
    const planeMaterial = new THREE.MeshStandardMaterial({
      color: 0x00ff00,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    })
    this.planeMesh = new THREE.Mesh(planeGeometry, planeMaterial)
    this.planeMesh.castShadow = true
    this.trackedPlane.add(this.planeMesh)

    // Wireframe overlay
    const wireframeMaterial = new THREE.MeshBasicMaterial({
      color: 0x00ff00,
      wireframe: true,
      transparent: true,
      opacity: 0.8,
    })
    this.wireframeMesh = new THREE.Mesh(planeGeometry, wireframeMaterial)
    this.wireframeMesh.position.z = 0.01
    this.trackedPlane.add(this.wireframeMesh)

    // Text sprite for marker ID
    this.textSprite = this.createTextSprite(`Marker ${markerId}`, 0x00ff00)
    this.textSprite.position.set(0, 1, 0)
    this.trackedPlane.add(this.textSprite)

    // Coordinate axes
    this.coordinateAxes = this.createCoordinateAxes()
    this.trackedPlane.add(this.coordinateAxes)

    this.scene.add(this.trackedPlane)
  }

  private createTextSprite(text: string, color: number): THREE.Sprite {
    const canvas = document.createElement("canvas")
    const context = canvas.getContext("2d")!
    canvas.width = 256
    canvas.height = 64

    context.fillStyle = `#${color.toString(16).padStart(6, "0")}`
    context.font = "bold 24px Arial"
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillText(text, canvas.width / 2, canvas.height / 2)

    const texture = new THREE.CanvasTexture(canvas)
    const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true })
    const sprite = new THREE.Sprite(spriteMaterial)
    sprite.scale.set(2, 0.5, 1)

    return sprite
  }

  private createCoordinateAxes(): THREE.Group {
    const axesGroup = new THREE.Group()

    // X axis - Red
    const xGeometry = new THREE.CylinderGeometry(0.02, 0.02, 1)
    const xMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 })
    const xAxis = new THREE.Mesh(xGeometry, xMaterial)
    xAxis.position.set(0.5, 0, 0)
    xAxis.rotation.z = -Math.PI / 2
    axesGroup.add(xAxis)

    // Y axis - Green
    const yGeometry = new THREE.CylinderGeometry(0.02, 0.02, 1)
    const yMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 })
    const yAxis = new THREE.Mesh(yGeometry, yMaterial)
    yAxis.position.set(0, 0.5, 0)
    axesGroup.add(yAxis)

    // Z axis - Blue
    const zGeometry = new THREE.CylinderGeometry(0.02, 0.02, 1)
    const zMaterial = new THREE.MeshBasicMaterial({ color: 0x0000ff })
    const zAxis = new THREE.Mesh(zGeometry, zMaterial)
    zAxis.position.set(0, 0, 0.5)
    zAxis.rotation.x = Math.PI / 2
    axesGroup.add(zAxis)

    return axesGroup
  }

  private updatePlaneColor(confidence: number) {
    if (!this.planeMesh || !this.wireframeMesh || !this.textSprite) return

    let color: number
    if (confidence > 0.7)
      color = 0x00ff00 // Green
    else if (confidence > 0.4)
      color = 0xffaa00 // Orange
    else color = 0xff4444 // Red

    const opacity = Math.max(0.3, confidence)

    // Update materials
    ;(this.planeMesh.material as THREE.MeshStandardMaterial).color.setHex(color)
    ;(this.planeMesh.material as THREE.MeshStandardMaterial).opacity = opacity
    ;(this.wireframeMesh.material as THREE.MeshBasicMaterial).color.setHex(color)
    ;(this.wireframeMesh.material as THREE.MeshBasicMaterial).opacity = opacity * 0.8

    // Update text sprite color
    const canvas = document.createElement("canvas")
    const context = canvas.getContext("2d")!
    canvas.width = 256
    canvas.height = 64

    context.fillStyle = `#${color.toString(16).padStart(6, "0")}`
    context.font = "bold 24px Arial"
    context.textAlign = "center"
    context.textBaseline = "middle"
    context.fillText(this.textSprite.userData.text || "Marker", canvas.width / 2, canvas.height / 2)

    const texture = new THREE.CanvasTexture(canvas)
    ;(this.textSprite.material as THREE.SpriteMaterial).map = texture
  }

  private startAnimation() {
    const animate = () => {
      this.animationId = requestAnimationFrame(animate)
      // Update controls
      if (this.controls) {
        this.controls.update()
      }
      
      // Update tracked plane pose
      this.updateTrackedPlane()

      // Render scene
      this.renderer.render(this.scene, this.camera) 
    }

    animate()
  }

  private updateTrackedPlane() {
    // console.log("Updating tracked plane...", this.trackedPlane, this.targetPose);
    if (!this.trackedPlane || !this.targetPose) return
    const lerpFactor = 0.1 // Smooth interpolation factor

    if (!this.currentPose) {
      this.currentPose = {
        position: this.targetPose.position.clone(),
        rotation: this.targetPose.rotation.clone(),
        scale: this.targetPose.scale,
        confidence: this.targetPose.confidence,
      }
    }

    // Lerp position
    this.currentPose.position.lerp(this.targetPose.position, lerpFactor)
    this.trackedPlane.position.copy(this.currentPose.position)

    // Lerp rotation
    this.currentPose.rotation.x = THREE.MathUtils.lerp(
      this.currentPose.rotation.x,
      this.targetPose.rotation.x,
      lerpFactor,
    )
    this.currentPose.rotation.y = THREE.MathUtils.lerp(
      this.currentPose.rotation.y,
      this.targetPose.rotation.y,
      lerpFactor,
    )
    this.currentPose.rotation.z = THREE.MathUtils.lerp(
      this.currentPose.rotation.z,
      this.targetPose.rotation.z,
      lerpFactor,
    )
    this.trackedPlane.rotation.copy(this.currentPose.rotation)

    // Lerp scale
    this.currentPose.scale = THREE.MathUtils.lerp(this.currentPose.scale, this.targetPose.scale, lerpFactor)
    this.trackedPlane.scale.setScalar(this.currentPose.scale)

    // Update confidence
    this.currentPose.confidence = THREE.MathUtils.lerp(
      this.currentPose.confidence,
      this.targetPose.confidence,
      lerpFactor,
    )

    // Add subtle floating animation
    if (this.currentPose.confidence > 0.5) {
      const time = Date.now() * 0.002
      this.trackedPlane.position.y += Math.sin(time) * 0.02
    }

    // Update visual appearance based on confidence
    this.updatePlaneColor(this.currentPose.confidence)
  }

  public updateMarkerPose(pose: MarkerPose, markerId: number) {
    // Create plane if it doesn't exist
    if (!this.trackedPlane) {
      this.createTrackedPlane(markerId)
    }

    // Update target pose
    this.targetPose = {
      position: pose.position.clone(),
      rotation: pose.rotation.clone(),
      scale: pose.scale,
      confidence: pose.confidence,
    }
  }

  public clearMarkerPose() {
    if (this.trackedPlane) {
      this.scene.remove(this.trackedPlane)
      this.trackedPlane = null
      this.planeMesh = null
      this.wireframeMesh = null
      this.textSprite = null
      this.coordinateAxes = null
    }
    this.targetPose = null
    this.currentPose = null
  }

  private handleResize() {
    console.log("Resizing Three.js scene...")
    const container = this.renderer.domElement.parentElement
    if (!container) return

    const width = container.clientWidth
    const height = container.clientHeight

    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(width, height)
  }

  public dispose() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
    }

    window.removeEventListener("resize", this.handleResize.bind(this))

    if (this.controls) {
      this.controls.dispose()
    }

    this.renderer.dispose()
    this.scene.clear()
  }
}

export function ArUco3DTracker() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sceneContainerRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationFrameRef = useRef<number>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const sceneManagerRef = useRef<ThreeJSSceneManager | null>(null)
  const trackedMarkerIdRef = useRef<number | null>(6)

  const [isActive, setIsActive] = useState(false)
  const [error, setError] = useState<string>("")
  const [markers, setMarkers] = useState<ArUcoMarker[]>([])
  const [markerPose, setMarkerPose] = useState<MarkerPose | null>(null)
  const [stats, setStats] = useState<DetectionStats>({
    fps: 0,
    markersDetected: 0,
    totalDetections: 0,
    avgLatency: 0,
    connectionStatus: "disconnected",
    trackedMarkerId: null,
  })
  const [isLoading, setIsLoading] = useState(false)

  // Settings
  const [frameRate, setFrameRate] = useState(15)
  const [imageQuality, setImageQuality] = useState(0.4)
  const [processingWidth, setProcessingWidth] = useState(320)
  const [trackedMarkerId, setTrackedMarkerId] = useState<number>(6)
  const [markerSize, setMarkerSize] = useState(0.1)

  // FPS calculation
  const fpsRef = useRef({ lastTime: 0, frameCount: 0, fps: 0 })

  const calculateFPS = useCallback(() => {
    const now = performance.now()
    fpsRef.current.frameCount++

    if (now - fpsRef.current.lastTime >= 1000) {
      fpsRef.current.fps = Math.round((fpsRef.current.frameCount * 1000) / (now - fpsRef.current.lastTime))
      fpsRef.current.frameCount = 0
      fpsRef.current.lastTime = now
    }

    return fpsRef.current.fps
  }, [])

  // Calculate 3D pose from marker corners
  const calculateMarkerPose = useCallback(
    (marker: ArUcoMarker, imageWidth: number, imageHeight: number): MarkerPose => {
      const corners = marker.corners

      // Calculate marker area for scale estimation
      const area = Math.abs(
        (corners[0][0] * (corners[1][1] - corners[3][1]) +
          corners[1][0] * (corners[2][1] - corners[0][1]) +
          corners[2][0] * (corners[3][1] - corners[1][1]) +
          corners[3][0] * (corners[0][1] - corners[2][1])) /
          2,
      )

      // Estimate distance based on marker size
      const expectedArea = (markerSize * 1000) ** 2
      const distance = Math.sqrt(expectedArea / area) * 5

      // Calculate center position in normalized coordinates
      const centerX = (marker.center.x / imageWidth - 0.5) * 2
      const centerY = -(marker.center.y / imageHeight - 0.5) * 2

      // Calculate rotation based on corner orientation
      const dx = corners[1][0] - corners[0][0]
      const dy = corners[1][1] - corners[0][1]
      const rotationZ = Math.atan2(dy, dx)

      // Estimate tilt based on perspective distortion
      const topWidth = Math.sqrt((corners[1][0] - corners[0][0]) ** 2 + (corners[1][1] - corners[0][1]) ** 2)
      const bottomWidth = Math.sqrt((corners[2][0] - corners[3][0]) ** 2 + (corners[2][1] - corners[3][1]) ** 2)
      const leftHeight = Math.sqrt((corners[3][0] - corners[0][0]) ** 2 + (corners[3][1] - corners[0][1]) ** 2)
      const rightHeight = Math.sqrt((corners[2][0] - corners[1][0]) ** 2 + (corners[2][1] - corners[1][1]) ** 2)

      const rotationX = ((bottomWidth - topWidth) / (topWidth + bottomWidth)) * Math.PI * 0.5
      const rotationY = ((rightHeight - leftHeight) / (leftHeight + rightHeight)) * Math.PI * 0.5

      // Calculate confidence
      const avgWidth = (topWidth + bottomWidth) / 2
      const avgHeight = (leftHeight + rightHeight) / 2
      const aspectRatio = avgWidth / avgHeight
      const confidence = Math.max(0, 1 - Math.abs(aspectRatio - 1) * 2) * Math.min(1, area / 1000)

      return {
        position: new THREE.Vector3(centerX * distance * 0.5, centerY * distance * 0.5, -distance * 0.1),
        rotation: new THREE.Euler(rotationX, rotationY, rotationZ),
        scale: Math.max(0.5, Math.min(2, area / 5000)),
        confidence: confidence,
      }
    },
    [markerSize],
  )

  // Initialize Three.js scene
  useEffect(() => {
    if (sceneContainerRef.current && !sceneManagerRef.current) {
      // alert("Initializing Three.js scene manager...")
      sceneManagerRef.current = new ThreeJSSceneManager(sceneContainerRef.current)
      // alert(sceneManagerRef.current)
    }

    return () => {
      if (sceneManagerRef.current) {
        sceneManagerRef.current.dispose()
        sceneManagerRef.current = null
      }
    }
  }, [])

  // Initialize WebSocket connection
  const initializeWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    setStats((prev) => ({ ...prev, connectionStatus: "connecting" }))

    try {
      wsRef.current = new WebSocket("wss://arcuo-backend.onrender.com/ws")

      wsRef.current.onopen = () => {
        console.log("WebSocket connected for 3D tracking")
        setStats((prev) => ({ ...prev, connectionStatus: "connected" }))
        setError("")
      }

      wsRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
          if (data.type === "detection_result") {
            const detectedMarkers = data.markers || []
            setMarkers(detectedMarkers)

            // Find the tracked marker
            const trackedMarker = detectedMarkers.find((m: ArUcoMarker) => m.id === trackedMarkerIdRef.current)
            if (trackedMarker && sceneManagerRef.current) {
              // Calculate 3D pose
              const pose = calculateMarkerPose(trackedMarker, processingWidth, processingWidth * 0.75)
              setMarkerPose(pose)
              setStats((prev) => ({ ...prev, trackedMarkerId: trackedMarkerIdRef.current }))

              // Update 3D scene
              if (trackedMarkerIdRef.current !== null) {
                sceneManagerRef.current.updateMarkerPose(pose, trackedMarkerIdRef.current)
              }
            } else {
              setMarkerPose(null)
              setStats((prev) => ({ ...prev, trackedMarkerId: null }))

              // Clear 3D scene
              if (sceneManagerRef.current) {
                sceneManagerRef.current.clearMarkerPose()
              }
            }

            setStats((prev) => ({
              ...prev,
              markersDetected: detectedMarkers.length,
              totalDetections: prev.totalDetections + detectedMarkers.length,
            }))
          } else if (data.type === "error") {
            console.error("Server error:", data.message)
            setError(data.message)
          }
        } catch (err) {
          console.error("WebSocket message parsing error:", err)
        }
      }

      wsRef.current.onclose = () => {
        console.log("WebSocket disconnected")
        setStats((prev) => ({ ...prev, connectionStatus: "disconnected" }))

        if (isActive) {
          setTimeout(() => {
            if (isActive) {
              initializeWebSocket()
            }
          }, 2000)
        }
      }

      wsRef.current.onerror = (error) => {
        console.error("WebSocket error:", error)
        setError("WebSocket connection failed. Make sure the server is running." + 
          (typeof error === "string"
            ? error
            : JSON.stringify(error))
        )
        setStats((prev) => ({ ...prev, connectionStatus: "disconnected" }))
      }
    } catch (err) {
      console.error("WebSocket initialization error:", err)
      setError("Failed to initialize WebSocket connection" + 
        (typeof err === "string"
          ? err
          : JSON.stringify(err))
      )
    }
  }, [isActive, trackedMarkerId, calculateMarkerPose, processingWidth])

  // Process frame using CameraPreview.captureSimple
  const processFrame = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    try {
      const result = await CameraPreview.captureSample({ quality: imageQuality * 100 })
      // result.value is base64 string (no data:image/jpeg;base64, prefix)
      const frameData = "data:image/jpeg;base64," + result.value
      wsRef.current.send(
        JSON.stringify({
          type: "frame",
          frame: frameData,
          timestamp: Date.now(),
        }),
      )
      const fps = calculateFPS()
      setStats((prev) => ({ ...prev, fps }))
    } catch (err) {
      setError("Failed to capture frame from camera")
    }
  }, [imageQuality, calculateFPS])

  // Start camera using CameraPreview
  const startCamera = useCallback(async () => {
    setIsLoading(true)
    setError("")
    try {
      await CameraPreview.start({
        parent: "cameraPreview", // The id of the div where the preview will be shown
        position: "rear",
        x: 60,
        y: 700,
        width: 320,
        height: 240,
        toBack: false,
        className: "",
      })
      setIsActive(true)
      setIsLoading(false)
      initializeWebSocket()
    } catch (err) {
      setError("Camera Preview failed to start")
      setIsLoading(false)
    }
  }, [initializeWebSocket])

  useEffect(() => {
    startFrameProcessing()
  }, [isActive])

  // Start frame processing loop
  const startFrameProcessing = useCallback(() => {
    const processLoop = () => {
      if (isActive) {
        processFrame()
        setTimeout(() => {
          animationFrameRef.current = requestAnimationFrame(processLoop)
        }, 1000 / frameRate)
      }
    }
    processLoop()
  }, [isActive, processFrame, frameRate])

  // Stop camera
  const stopCamera = useCallback(async () => {
    try {
      await CameraPreview.stop()
    } catch {}
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    if (sceneManagerRef.current) {
      sceneManagerRef.current.clearMarkerPose()
    }
    setIsActive(false)
    setMarkers([])
    setMarkerPose(null)
    setStats({
      fps: 0,
      markersDetected: 0,
      totalDetections: 0,
      avgLatency: 0,
      connectionStatus: "disconnected",
      trackedMarkerId: null,
    })
  }, [])

  // Reset stats
  const resetStats = useCallback(() => {
    setStats((prev) => ({
      ...prev,
      totalDetections: 0,
      avgLatency: 0,
    }))
    fpsRef.current = { lastTime: 0, frameCount: 0, fps: 0 }
  }, [])

  // Update tracked marker ID
  const handleMarkerIdChange = useCallback((newId: number) => {
    setTrackedMarkerId(newId)
    trackedMarkerIdRef.current = newId
    if (sceneManagerRef.current) {
      sceneManagerRef.current.clearMarkerPose()
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera()
    }
  }, [stopCamera])

  return (
    <IonPage>
      <IonContent fullscreen className="ion-padding" style={{ background: "linear-gradient(135deg, #e0e7ff 0%, #f1f5f9 100%)" }}>
        {/* Controls */}
        <IonCard>
          <IonCardHeader>
            <IonCardTitle>
              <IonIcon name="cube" style={{ color: "#3b82f6", marginRight: 8, verticalAlign: "middle" }} />
              ArUco 3D Tracking <span style={{ fontSize: 12, color: "#64748b" }}>(Three.js)</span>
            </IonCardTitle>
          </IonCardHeader>
          <IonCardContent>
            <IonGrid>
              <IonRow className="ion-align-items-center">
                <IonCol size="auto">
                  <IonButton
                    color={isActive ? "danger" : "primary"}
                    onClick={isActive ? stopCamera : startCamera}
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <IonSpinner name="dots" />
                    ) : isActive ? (
                      <>
                        <IonIcon name="camera-off" slot="start" />
                        Stop Tracking
                      </>
                    ) : (
                      <>
                        <IonIcon name="camera" slot="start" />
                        Start Tracking
                      </>
                    )}
                  </IonButton>
                </IonCol>
                <IonCol size="auto">
                    <IonButton onClick={resetStats} color="medium" disabled={!isActive}>
                    <IonIcon icon="refresh-outline" slot="start" />
                    Reset Stats
                  </IonButton>
                </IonCol>
                <IonCol size="auto">
                  <IonIcon
                    name="wifi"
                    style={{
                      color: stats.connectionStatus === "connected" ? "#22c55e" : "#ef4444",
                      verticalAlign: "middle",
                    }}
                  />
                  <span style={{ marginLeft: 8, textTransform: "capitalize" }}>{stats.connectionStatus}</span>
                </IonCol>
                {stats.trackedMarkerId !== null && (
                  <IonCol size="auto">
                    <IonBadge color="success">Tracking ID: {stats.trackedMarkerId}</IonBadge>
                  </IonCol>
                )}
              </IonRow>
            </IonGrid>
          </IonCardContent>
        </IonCard>

        {/* Error Alert */}
        <IonAlert
          isOpen={!!error}
          onDidDismiss={() => setError("")}
          header="Error"
          message={error}
          buttons={['OK']}
        />

        {/* Stats */}
        {isActive && (
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>Tracking Statistics</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <IonGrid>
                <IonRow>
                  <IonCol className="ion-text-center">
                    <div style={{ fontSize: 28, color: "#22c55e", fontWeight: "bold" }}>{stats.fps}</div>
                    <div style={{ color: "#64748b" }}>FPS</div>
                  </IonCol>
                  <IonCol className="ion-text-center">
                    <div style={{ fontSize: 28, color: "#3b82f6", fontWeight: "bold" }}>{stats.markersDetected}</div>
                    <div style={{ color: "#64748b" }}>Markers Detected</div>
                  </IonCol>
                  <IonCol className="ion-text-center">
                    <div style={{ fontSize: 28, color: "#a21caf", fontWeight: "bold" }}>{stats.totalDetections}</div>
                    <div style={{ color: "#64748b" }}>Total Detections</div>
                  </IonCol>
                  <IonCol className="ion-text-center">
                    <div style={{ fontSize: 28, color: stats.trackedMarkerId !== null ? "#22c55e" : "#ef4444", fontWeight: "bold" }}>
                      {stats.trackedMarkerId !== null ? "TRACKING" : "LOST"}
                    </div>
                    <div style={{ color: "#64748b" }}>Status</div>
                  </IonCol>
                </IonRow>
              </IonGrid>
            </IonCardContent>
          </IonCard>
        )}

        {/* 3D Scene and Camera Feed */}
        <IonGrid>
          <IonRow>
            <IonCol>
              <IonCard>
                <IonCardHeader>
                  <IonCardTitle>3D Scene (Three.js)</IonCardTitle>
                </IonCardHeader>
                <IonCardContent>
                  <div
                    ref={sceneContainerRef}
                    style={{
                      width: "100%",
                      height: 220,
                      background: "linear-gradient(135deg, #000 0%, #1e293b 100%)",
                      borderRadius: 12,
                      overflow: "hidden",
                    }}
                  />
                </IonCardContent>
              </IonCard>
            </IonCol>
            <IonCol>
              <IonCard>
                <IonCardHeader>
                  <IonCardTitle>Camera Feed</IonCardTitle>
                </IonCardHeader>
                <IonCardContent>
                  <div id="cameraPreview" style={{ width: "100%", height: 220, background: "#000", borderRadius: 12 }} />
                  {!isActive && (
                    <div style={{
                      width: "100%",
                      height: 220,
                      background: "linear-gradient(135deg, #dbeafe 0%, #bae6fd 100%)",
                      borderRadius: 12,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center"
                    }}>
                      <IonIcon name="cube" style={{ fontSize: 48, color: "#3b82f6", marginBottom: 12 }} />
                      <p style={{ color: "#1e293b", fontWeight: "bold" }}>
                        {stats.connectionStatus === "disconnected"
                          ? "Start WebSocket server: python scripts/aruco_websocket_server.py"
                          : "Click 'Start Tracking' to begin 3D tracking"}
                      </p>
                    </div>
                  )}
                </IonCardContent>
              </IonCard>
            </IonCol>
          </IonRow>
        </IonGrid>

        {/* Available Markers */}
        {markers.length > 0 && (
          <IonCard>
            <IonCardHeader>
              <IonCardTitle>Available Markers</IonCardTitle>
            </IonCardHeader>
            <IonCardContent>
              <IonGrid>
                <IonRow>
                  {markers.map((marker, index) => (
                    <IonCol key={index} size="6" sizeMd="3" sizeLg="2">
                      <div
                        style={{
                          padding: 12,
                          border: marker.id === trackedMarkerId ? "2px solid #22c55e" : "1px solid #e5e7eb",
                          borderRadius: 8,
                          background: marker.id === trackedMarkerId ? "#dcfce7" : "#f1f5f9",
                          textAlign: "center",
                          cursor: "pointer",
                          marginBottom: 8,
                        }}
                        onClick={() => handleMarkerIdChange(marker.id)}
                      >
                        <IonBadge color={marker.id === trackedMarkerId ? "success" : "primary"}>
                          ID: {marker.id}
                        </IonBadge>
                        <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                          ({Math.round(marker.center.x)}, {Math.round(marker.center.y)})
                        </div>
                      </div>
                    </IonCol>
                  ))}
                </IonRow>
              </IonGrid>
            </IonCardContent>
          </IonCard>
        )}
      </IonContent>
    </IonPage>
  )
}
