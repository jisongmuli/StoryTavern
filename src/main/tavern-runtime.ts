import { app } from 'electron'
import path from 'node:path'
app.setName('StoryTavern')
app.setPath('userData', path.join(app.getPath('appData'), 'StoryTavern'))
