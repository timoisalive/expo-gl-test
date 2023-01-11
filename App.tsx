import { ExpoWebGLRenderingContext, GLView } from "expo-gl"
import { useEffect, useState } from "react"
import { View } from "react-native"
import { Renderer } from "./Renderer"

export default function App() {
  const [initialized, setInitialized] = useState(false)
  const [gl, setGL] = useState<ExpoWebGLRenderingContext>()

  const [renderer] = useState(Renderer)

  const updateAndRender = () => {
    renderer.addParticle(
      Math.floor(Math.random() * 300),
      Math.floor(Math.random() * 300),
      Math.floor(Math.random() * 16777215)
    )

    renderer.addStaticParticle(
      Math.floor(Math.random() * 300),
      Math.floor(Math.random() * 300),
      Math.floor(Math.random() * 16777215)
    )

    renderer.render()
  }

  useEffect(() => {
    if (gl) {
      renderer.initialize(gl)
      setInitialized(true)
    }
  }, [gl])

  useEffect(() => {
    if (!initialized) return () => {}

    const timer = setInterval(() => {
      updateAndRender()
    }, 1000 / 60)

    return () => clearInterval(timer)
  }, [initialized])

  return (
    <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
      <GLView
        style={{ backgroundColor: "#ffe0e0", width: 300, height: 300 }}
        onContextCreate={setGL}
      />
    </View>
  )
}
