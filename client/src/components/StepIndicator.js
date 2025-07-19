import React from 'react';
import { motion } from 'framer-motion';

const StepIndicator = ({ steps, currentStep }) => {
  return (
    <div className="w-full max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isActive = step.id === currentStep;
          const isCompleted = step.id < currentStep;
          const isLast = index === steps.length - 1;

          return (
            <div key={step.id} className="flex items-center flex-1">
              {/* Step Circle */}
              <div className="relative flex flex-col items-center">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: index * 0.1 }}
                  className={`
                    relative w-12 h-12 rounded-full flex items-center justify-center font-semibold text-sm transition-all duration-300
                    ${isCompleted
                      ? 'bg-gradient-to-r from-green-500 to-emerald-600 text-white shadow-lg'
                      : isActive
                        ? 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white shadow-lg ring-4 ring-blue-200'
                        : 'bg-white text-gray-400 border-2 border-gray-200 shadow-sm'
                    }
                  `}
                >
                  {isCompleted ? (
                    <motion.svg
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.2 }}
                      className="w-5 h-5"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </motion.svg>
                  ) : (
                    <span>{step.id}</span>
                  )}
                  
                  {/* Active pulse effect */}
                  {isActive && (
                    <div className="absolute inset-0 rounded-full bg-blue-400 animate-ping opacity-20"></div>
                  )}
                </motion.div>

                {/* Step Label */}
                <div className="mt-4 text-center max-w-32">
                  <motion.h3
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 + 0.1 }}
                    className={`
                      text-sm font-semibold transition-colors duration-200
                      ${isActive ? 'text-blue-700' : isCompleted ? 'text-green-700' : 'text-gray-500'}
                    `}
                  >
                    {step.title}
                  </motion.h3>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 + 0.2 }}
                    className="text-xs text-gray-500 mt-1 leading-tight"
                  >
                    {step.description}
                  </motion.p>
                </div>
              </div>

              {/* Connector Line */}
              {!isLast && (
                <div className="flex-1 mx-6 mt-[-3rem]">
                  <div className="relative">
                    <div className="h-1 bg-gray-200 w-full rounded-full"></div>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{
                        width: isCompleted ? '100%' : isActive ? '50%' : '0%'
                      }}
                      transition={{ duration: 0.5, delay: index * 0.1 }}
                      className={`
                        absolute top-0 left-0 h-1 rounded-full
                        ${isCompleted ? 'bg-gradient-to-r from-green-500 to-emerald-600' : 'bg-gradient-to-r from-blue-500 to-indigo-600'}
                      `}
                    ></motion.div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Progress Bar */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="mt-8 glass rounded-xl p-4 backdrop-blur-sm"
      >
        <div className="flex justify-between text-sm font-medium text-gray-700 mb-3">
          <span>Overall Progress</span>
          <span className="text-blue-600">{Math.round(((currentStep - 1) / (steps.length - 1)) * 100)}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="h-full bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full shadow-sm"
          ></motion.div>
        </div>
      </motion.div>
    </div>
  );
};

export default StepIndicator;