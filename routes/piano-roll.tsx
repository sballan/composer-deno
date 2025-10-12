import PianoRoll from "../islands/PianoRoll.tsx";

export default function PianoRollPage() {
  return (
    <div class="h-screen w-screen bg-gray-900">
      <PianoRoll midiUrl="/Bach.mid" />
    </div>
  );
}
