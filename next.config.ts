import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // tesseract.js / sharp usan binarios nativos — no bundlear en el server chunk
  serverExternalPackages: ["tesseract.js", "sharp", "web-push"],
  // tesseract.js arranca su worker con `new Worker(<ruta>)`: el tracer copia ese
  // archivo de entrada pero no sigue sus require(), así que en Vercel el worker
  // moría con MODULE_NOT_FOUND. Sin listener de 'error' (tesseract.js usa
  // `worker.onerror`, API de navegador) Node relanza el fallo en el hilo principal
  // y tumba la función entera: el POST se queda sin respuesta y cualquier GET en
  // esa misma instancia falla con «Failed to fetch».
  outputFileTracingIncludes: {
    "/api/tpv-cortes": [
      // El paquete se carga con require() en runtime (para poder envolver
      // spawnWorker antes que createWorker), así que el bundler ya no lo ve.
      "./node_modules/tesseract.js/package.json",
      "./node_modules/tesseract.js/src/**/*.js",
      // Todas las variantes: `getCore` compara `[OEM.DEFAULT, OEM.LSTM_ONLY]`
      // contra un booleano, así que en la práctica pide siempre el core completo.
      "./node_modules/tesseract.js-core/**",
      "./node_modules/wasm-feature-detect/package.json",
      "./node_modules/wasm-feature-detect/dist/**",
      "./node_modules/bmp-js/**",
      "./node_modules/regenerator-runtime/**",
      "./node_modules/is-url/**",
      "./tessdata/spa.traineddata",
    ],
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=0, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
