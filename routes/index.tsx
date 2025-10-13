import { Head } from "fresh/runtime";
import { define } from "../utils.ts";

export default define.page(function Home() {
  return (
    <div class="px-4 py-8 mx-auto min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      <Head>
        <title>Composer - MIDI Music Creation</title>
      </Head>
      <div class="max-w-screen-md mx-auto flex flex-col items-center justify-center text-center">
        <h1 class="text-6xl font-bold text-white mb-4">
          Composer
        </h1>
        <p class="text-xl text-gray-300 mb-12">
          Create beautiful music with our intuitive MIDI editor
        </p>
        <a
          href="/piano-roll"
          class="px-8 py-4 bg-purple-600 hover:bg-purple-700 text-white text-lg font-semibold rounded-lg shadow-lg transition-colors duration-200"
        >
          Piano Roll
        </a>
      </div>
    </div>
  );
});
