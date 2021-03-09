# TODO list

This is a collection of different things I need to fix/add to the DKR renderer to make it look more like the real game. These are in no particular order.

Last updated March 5th 2021

## Figure out and implement dynamic lighting

I'm not sure how lighting is currently done in DKR. It seems to be used more rarely compared to other N64 games.

![](https://i.imgur.com/t7iukRj.png)

## Implement environment mapping

There is a flag in the game's draw calls that determine if environment mapping is enabled. However, I need to get dynamic lighting working first before I can implement environment mapping.

![](https://i.imgur.com/AyUt8eM.png)

## Fix vertex alpha

In the ocean section of the Central Area, the edges of the map and the beaches fade to black instead of transparent. I need to adjust the level loading code to take vertex alpha into account.

![](https://i.imgur.com/BfiWiGS.png)


## Figure out and implement water waves

All of the water in the renderer is currently flat. I need to learn how the game adjusts the vertices to make the waves.

![](https://i.imgur.com/O7Iwe5S.png)


## Improve Taj & T.T.

In the hub levels, both Taj & T.T. are currently frozen in place. I want to make it so that they move around like they do in-game.

![](https://i.imgur.com/bZqqZIx.png)

## Implement the Wizpig ghosts in Haunted Woods

Currently, DkrAnimationTrack only supports 3D models. I need to add support for 2D billboard sprites.

![](https://i.imgur.com/EvGOcMq.png)

## Figure out and implement shadows

Currently there are no drop-shadows for any of the models or billboards. I need to figure out how the game draws them.

![](https://i.imgur.com/1pGqh0I.png)

Shadows are more than just a flat texture, as they can adjust to the floor terrain.

![](https://i.imgur.com/WoBhCC3.png)

## Figure out and properly implement ground zippers

Currently, in the editor the ground zippers are flat squares on the ground. This is fine for most of the zippers, but the ones on inclines look wrong. The ground zippers are drawn like shadows, so once I implement shadows then I can fix these.

![](https://i.imgur.com/oGOaJzy.png)

## Improve the flyby camera to include cutscenes

Right now, the "flyby camera" panel only works with the game's flyby previews. However, I can extend this system to work with the game's cutscenes as well. You can find an example of that here: https://www.youtube.com/watch?v=TSOZNyn5-4s.

I couldn't get the timings to work correctly on most of the cutscenes, so most of that functionality is commented out for now. I need to do some more work on decomp to help me figure out the animation camera system.

![](https://i.imgur.com/8KxQC8r.png)
