/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** `true` keeps the internal /foundations page in a production build (it is left out otherwise). */
  readonly VITE_STUDIO_FOUNDATIONS?: string;
}
