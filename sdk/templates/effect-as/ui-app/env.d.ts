// Types for what Vite gives the app beyond TypeScript: a stylesheet import, a `?base64` file
// (vite.config.ts's base64Import) and est.json for the stand-in engine.
declare module '*.css';
declare module '*?base64' {
  const data: string;
  export default data;
}
