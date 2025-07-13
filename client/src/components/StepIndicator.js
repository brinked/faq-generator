import React from 'react';
import { motion } from 'framer-motion';

const StepIndicator = ({ steps, currentStep }) => {
  return (
    <div className="w-full max-w-4xl mx-auto">
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
                    step-indicator
                    ${isCompleted ? 'step-completed' : isActive ? 'step-active' : 'step-pending'}
                  `}
                >
                  {isCompleted ? (
                    <motion.svg
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.2 }}
                      className="w-4 h-4"
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
                </motion.div>

                {/* Step Label */}
                <div className="mt-3 text-center">
                  <motion.h3
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 + 0.1 }}
                    className={`
                      text-sm font-medium
                      ${isActive ? 'text-primary-600' : isCompleted ? 'text-success-600' : 'text-gray-500'}
                    `}
                  >
                    {step.title}
                  </motion.h3>
                  <motion.p
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.1 + 0.2 }}
                    className="text-xs text-gray-400 mt-1 max-w-24"
                  >
                    {step.description}
                  </motion.p>
                </div>
              </div>

              {/* Connector Line */}
              {!isLast && (
                <div className="flex-1 mx-4 mt-[-2rem]">
                  <div className="relative">
                    <div className="h-0.5 bg-gray-200 w-full"></div>
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ 
                        width: isCompleted ? '100%' : isActive ? '50%' : '0%' 
                      }}
                      transition={{ duration: 0.5, delay: index * 0.1 }}
                      className={`
                        absolute top-0 left-0 h-0.5
                        ${isCompleted ? 'bg-success-500' : 'bg-primary-500'}
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
        className="mt-8"
      >
        <div className="flex justify-between text-xs text-gray-500 mb-2">
          <span>Progress</span>
          <span>{Math.round(((currentStep - 1) / (steps.length - 1)) * 100)}%</span>
        </div>
        <div className="progress-bar">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${((currentStep - 1) / (steps.length - 1)) * 100}%` }}
            transition={{ duration: 0.8, ease: "easeOut" }}
            className="progress-fill"
          ></motion.div>
        </div>
      </motion.div>
    </div>
  );
};

export default StepIndicator;