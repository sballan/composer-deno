# Composer

An in browser music editor.

## Things you can do

- Play midi files in your browser. You can upload them directly from your
  desktop
- Transport controls to play, pause.
- Mute and Solo each track

## User Interface

### Piano Roll

In the Piano roll, you can see your midi file on display with a grid of musical
notes. This view has a few parts:

- The _grid_ is rendered in a _canvas_ element.
- The _ui_ is rendered with preact, and hosts the _grid_. The UI is created
  here, with buttons displayed around the _grid_.
