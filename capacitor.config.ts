import type { CapacitorConfig } from '@capacitor/cli'
import { KeyboardResize } from '@capacitor/keyboard'
const config: CapacitorConfig = {
  appId: 'com.local.chatboxtavern',
  appName: '故事酒馆',
  webDir: 'release/app/dist/renderer',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false },
  plugins: {
    SplashScreen: { launchShowDuration: 400, backgroundColor: '#ffffff' },
    CapacitorHttp: { enabled: true },
    Keyboard: { resize: KeyboardResize.Native },
  },
}
export default config
