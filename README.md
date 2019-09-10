<img align="right" src="src/logo.png">

# <a href="https://noclip.website">noclip</a>

The reverse engineering of model formats was done by many people. See the application for full credits.

## Contributing

Contributions are very welcome! New games, new features, and bug fixes are all very appreciated. Even small contributions like proper map names, grouping maps and new default savestates are extremely helpful.

If you would like contribute, there is a Getting Started guide in the [Official noclip.website Discord Server](https://discord.gg/bkJmKKv). A number of developers from the community are present there and can help answer questions if you run into any additional issues getting set up.

## Controls

- Global
	- Z: Hide HUD
	- T: Open games list
	- G: Open save state menu
	- Numpad 3: Export save states
	- Numpad 7: Take screenshot
	- Numpad 9: Export textures
	- Number key: Load save state
	- Period: Freeze/unfreeze time
	- Comma: Reset time to zero
- WASD mode
	- B: Reset camera position
	- WASD/Arrow Keys: Move camera
	- IJKL/Drag Mouse: Pan/tilt camera
	- Shift: Increase camera speed
	- Q/Page Down/Ctrl+Space: Move camera down
	- E/Page Up/Space: Move camera up
	- Scroll Wheel: Change camera speed
- Orbit mode
	- R: Toggle orbiting
	- Numpad 5: Immediately stop orbiting
	- B: Reset center
	- WASD: Move center
	- Shift+WASD/Mouse Drag: Orbit camera
	- Scroll Wheel: Zoom
- Ortho mode
	- R: Start/stop orbiting
	- B: Reset camera position
	- Numpad 5: Stop orbiting
	- Numpad 2/4/6/8: Front/Left/Right/Top view
	- Q: Zoom out
	- E: Zoom in
	- WASD: Move camera
	- Shift+WASD: Rotate camera
	- Scroll Wheel: zoom

## Getting Started

Install nodejs and npm through your package manager. For Windows, you can use the installer from [NodeJS.org](https://nodejs.org/). Open a terminal here and type the following commands:

```shell
npm install
npm start
```

This will download the required packages, and start a development server. It's available at http://localhost:1234/. This does not include game data files. You'll have to extract them yourself.
