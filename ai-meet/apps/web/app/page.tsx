export default function Home() {
  return (
    <div className="flex flex-col min-h-screen bg-gray-900 text-white">
      <header className="px-4 lg:px-6 h-14 flex items-center border-b border-gray-800">
        <h1 className="text-xl font-bold">AI Meet</h1>
      </header>
      <main className="flex-1 flex items-center justify-center">
        <div className="bg-gray-950 p-8 rounded-lg shadow-xl w-full max-w-md">
          <h2 className="text-2xl font-bold text-center mb-6">Join a Meeting</h2>
          <div className="space-y-4">
            <button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-md h-10">
              Create New Meeting
            </button>
            <div className="flex items-center space-x-2">
              <hr className="flex-grow border-gray-700"/>
              <span className="text-gray-400">or</span>
              <hr className="flex-grow border-gray-700"/>
            </div>
            <input
              type="text"
              placeholder="Enter Meeting ID"
              className="w-full bg-gray-800 text-white placeholder-gray-500 px-4 py-2 rounded-md h-10 border border-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            <button className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md h-10">
              Join Meeting
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
