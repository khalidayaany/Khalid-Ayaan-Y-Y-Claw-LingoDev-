'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

const CliTheme = () => {
  const [progress, setProgress] = useState(0);
  const [showMainInterface, setShowMainInterface] = useState(false);

  useEffect(() => {
    const loadingInterval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(loadingInterval);
          setTimeout(() => {
            setShowMainInterface(true);
          }, 500);
          return 100;
        }
        return prev + 2;
      });
    }, 50);

    return () => clearInterval(loadingInterval);
  }, []);

  if (!showMainInterface) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-black text-white font-mono p-4">
        <div className="w-full max-w-2xl">
          <div className="mb-8 text-center">
            <div className="text-gray-500 mb-2">Loading Khalid AI</div>
            <div className="w-full bg-gray-800 h-2 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-orange-500 to-cyan-400"
                initial={{ width: '0%' }}
                animate={{ width: `${progress}%` }}
                transition={{ duration: 0.1 }}
              />
            </div>
            <div className="text-right text-sm text-gray-400 mt-1">{progress}%</div>
          </div>

          <pre className="text-center text-xs leading-3 text-orange-500">
            {`    ██╗  ██╗██╗  ██╗ █████╗ ██╗     ██╗██████╗      █████╗ ██╗   ██╗ █████╗  █████╗ ███╗   ██╗    ██╗   ██╗
    ██║ ██╔╝██║  ██║██╔══██╗██║     ██║██╔══██╗    ██╔══██╗╚██╗ ██╔╝██╔══██╗██╔══██╗████╗  ██║    ╚██╗ ██╔╝
    █████╔╝ ███████║███████║██║     ██║██║  ██║    ███████║ ╚████╔╝ ███████║███████║██╔██╗ ██║     ╚████╔╝
    ██╔═██╗ ██╔══██║██╔══██║██║     ██║██║  ██║    ██╔══██║  ╚██╔╝  ██╔══██║██╔══██║██║╚██╗██║      ╚██╔╝
    ██║  ██╗██║  ██║██║  ██║███████╗██║██████╔╝    ██║  ██║   ██║   ██║  ██║██║  ██║██║ ╚████║       ██║
    ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝╚═╝╚═════╝     ╚═╝  ╚═╝   ╚═╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝       ╚═╝   `}
          </pre>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen max-w-4xl mx-auto bg-black text-white font-mono text-sm">
      <div className="bg-gray-900 p-3 border-b border-gray-700">
        <div className="flex items-center space-x-2">
          <div className="w-3 h-3 bg-red-500 rounded-full"></div>
          <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
          <div className="w-3 h-3 bg-green-500 rounded-full"></div>
          <h2 className="ml-4 text-cyan-400 font-bold">Khalid AI</h2>
        </div>
      </div>

      <div className="p-4 bg-gray-900 border-b border-gray-700">
        <div className="text-cyan-400 font-bold mb-2">Available Commands</div>
        <div className="grid grid-cols-2 gap-2 mb-4">
          <div className="flex">
            <span className="text-cyan-400">▸ </span>
            <span className="text-orange-500 font-bold">/help       </span>
            <span className="text-gray-600">│ </span>
            <span className="text-gray-400">Show help information</span>
          </div>
          <div className="flex">
            <span className="text-cyan-400">▸ </span>
            <span className="text-orange-500 font-bold">/status     </span>
            <span className="text-gray-600">│ </span>
            <span className="text-gray-400">Check system status</span>
          </div>
        </div>
        <div className="text-gray-600 border-t border-gray-700 pt-2">
          Type any command to get started
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 bg-gray-800">
        <div className="text-gray-400">
          Welcome to Khalid AI CLI!
        </div>
      </div>

      <div className="border-t border-gray-700 p-3 bg-gray-900">
        <div className="flex items-center">
          <span className="text-orange-500 font-bold mr-2">Khalid Ai</span>
          <span className="text-white mr-2">&gt;</span>
          <span className="flex-1 text-gray-200 animate-pulse">▌</span>
        </div>
      </div>
    </div>
  );
};

export default CliTheme;
