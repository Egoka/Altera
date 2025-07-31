<template>
  <div class="relative w-80 h-[500px] rounded-3xl overflow-hidden bg-[#000] left-[5rem]">
    <svg viewBox="100 0 300 500" xmlns="http://www.w3.org/2000/svg" class="w-full h-full">
      <!-- Красная волна -->
      <path :d="wave1" fill="#003636" class="blur-[60px] opacity-90 mix-blend-plus-lighter" />
      <!-- Жёлтая волна -->
      <path :d="wave2" fill="#FF2636" class="blur-[40px] opacity-80 mix-blend-plus-lighter" />
      <!-- Белая волна -->
      <path :d="wave3" fill="#FF00FF" class="blur-[16px] opacity-70 mix-blend-plus-lighter" />
    </svg>
    <div class="absolute inset-0 flex justify-center items-center text-6xl text-">Огонь</div>
  </div>
</template>

<script setup>
  import { ref, onMounted } from "vue"

  const wave1 = ref("")
  const wave2 = ref("")
  const wave3 = ref("")

  const params = ref({
    wave1: { amp: 80, freq: 1, offset: 250, speed: 2, direction: 1 },
    wave2: { amp: 50, freq: 1, offset: 350, speed: 2, direction: -1 },
    wave3: { amp: 20, freq: 1, offset: 450, speed: 1, direction: 1 }
  })

  // Целевые параметры для плавного перехода
  const targetParams = ref({
    wave1: { amp: 80, freq: 1, offset: 250, speed: 2, direction: 1 },
    wave2: { amp: 50, freq: 1, offset: 350, speed: 2, direction: -1 },
    wave3: { amp: 20, freq: 1, offset: 450, speed: 1, direction: 1 }
  })

  function randomInRange(min, max) {
    return Math.random() * (max - min) + min
  }

  // Функция линейной интерполяции
  function lerp(start, end, factor) {
    return start + (end - start) * factor
  }

  function updateWaveParams() {
    setInterval(() => {
      // Устанавливаем новые целевые значения
      targetParams.value.wave1.amp = randomInRange(70, 90)
      targetParams.value.wave1.freq = randomInRange(0.8, 1.4)
      targetParams.value.wave1.speed = randomInRange(1, 3)
      // Меняем направление только при минимальной скорости (1)
      if (targetParams.value.wave1.speed <= 1.5) {
        targetParams.value.wave1.direction = Math.random() > 0.5 ? 1 : -1
      }

      targetParams.value.wave2.amp = randomInRange(40, 100)
      targetParams.value.wave2.freq = randomInRange(0.8, 1.6)
      targetParams.value.wave2.speed = randomInRange(1, 5)
      // Меняем направление только при минимальной скорости (3)
      if (targetParams.value.wave2.speed <= 1.5) {
        targetParams.value.wave2.direction = Math.random() > 0.5 ? 1 : -1
      }

      targetParams.value.wave3.amp = randomInRange(15, 30)
      targetParams.value.wave3.freq = randomInRange(0.9, 1.8)
      targetParams.value.wave3.speed = randomInRange(1, 5)
      // Меняем направление только при минимальной скорости (3)
      if (targetParams.value.wave3.speed <= 1.5) {
        targetParams.value.wave3.direction = Math.random() > 0.5 ? 1 : -1
      }
    }, 3000)
  }

  function generateWavePath(amplitude, frequency, phase, heightOffset) {
    const width = 500
    const height = 500
    let path = `M0,${height} `

    for (let x = 0; x <= width; x += 5) {
      const base = (x / width) * frequency * 2 * Math.PI
      const noise =
        Math.sin(base + phase) * amplitude * 0.6 +
        Math.sin(base * 1.5 + phase * 0.7) * amplitude * 0.3 +
        Math.sin(base * 3.5 + phase * 1.3) * amplitude * 0.1

      const randomOffset = Math.sin(x * 0.05 + phase * 0.3) * 4
      const y = heightOffset + noise + randomOffset
      path += `L${x},${y} `
    }

    path += `L${width},${height} Z`
    return path
  }

  onMounted(() => {
    updateWaveParams()

    function animate(time) {
      const t = time / 1000

      // Скорость интерполяции (чем больше, тем быстрее переход)
      const lerpFactor = 0.02
      const speedLerpFactor = 0.00005 // Очень медленные переходы для скорости

      // Плавно приближаем текущие параметры к целевым
      params.value.wave1.amp = lerp(params.value.wave1.amp, targetParams.value.wave1.amp, lerpFactor)
      params.value.wave1.freq = lerp(params.value.wave1.freq, targetParams.value.wave1.freq, lerpFactor)
      params.value.wave1.speed = lerp(params.value.wave1.speed, targetParams.value.wave1.speed, speedLerpFactor)
      params.value.wave1.direction = lerp(
        params.value.wave1.direction,
        targetParams.value.wave1.direction,
        lerpFactor * 0.1
      )

      params.value.wave2.amp = lerp(params.value.wave2.amp, targetParams.value.wave2.amp, lerpFactor)
      params.value.wave2.freq = lerp(params.value.wave2.freq, targetParams.value.wave2.freq, lerpFactor)
      params.value.wave2.speed = lerp(params.value.wave2.speed, targetParams.value.wave2.speed, speedLerpFactor)
      params.value.wave2.direction = lerp(
        params.value.wave2.direction,
        targetParams.value.wave2.direction,
        lerpFactor * 0.1
      )

      params.value.wave3.amp = lerp(params.value.wave3.amp, targetParams.value.wave3.amp, lerpFactor)
      params.value.wave3.freq = lerp(params.value.wave3.freq, targetParams.value.wave3.freq, lerpFactor)
      params.value.wave3.speed = lerp(params.value.wave3.speed, targetParams.value.wave3.speed, speedLerpFactor)
      params.value.wave3.direction = lerp(
        params.value.wave3.direction,
        targetParams.value.wave3.direction,
        lerpFactor * 0.1
      )

      wave1.value = generateWavePath(
        params.value.wave1.amp,
        params.value.wave1.freq,
        t * params.value.wave1.speed * params.value.wave1.direction,
        params.value.wave1.offset
      )
      wave2.value = generateWavePath(
        params.value.wave2.amp,
        params.value.wave2.freq,
        t * params.value.wave2.speed * params.value.wave2.direction + 1,
        params.value.wave2.offset
      )
      wave3.value = generateWavePath(
        params.value.wave3.amp,
        params.value.wave3.freq,
        t * params.value.wave3.speed * params.value.wave3.direction + 10,
        params.value.wave3.offset
      )

      requestAnimationFrame(animate)
    }

    animate(0)
  })
</script>

<style scoped>
  /* Tailwind handles the styling */
</style>
