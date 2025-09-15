import React, { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Box,
  Typography,
  TextField,
  Button,
  Paper,
  Divider,
  CircularProgress,
} from "@mui/material";
import { useNavigate, useParams } from "react-router-dom";
import { fetchAuthSession } from "aws-amplify/auth";

import StudentHeader from "../../components/StudentHeader";
import InstructorHeader from "../../components/InstructorHeader";
import SideMenu from "./SideMenu";
import TypingIndicator from "./TypingIndicator";
import NotFound from "../NotFound";

import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import MicIcon from "@mui/icons-material/Mic";
import SummarizeIcon from "@mui/icons-material/Summarize";
import StopRounded from "@mui/icons-material/StopRounded";
import { VolumeUpRounded } from "@mui/icons-material";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import CheckIcon from "@mui/icons-material/Check";
import MessageCopyButton from "../../components/MessageCopyButton";


const InterviewAssistant = () => {
  const { caseId } = useParams();
  const navigate = useNavigate();

  const [userRole, setUserRole] = useState("student"); // Default role is "student"
  const [caseData, setCaseData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: "",
    severity: "info",
  });
  const [messageCounter, setMessageCounter] = useState(null);
  const [messageLimit, setMessageLimit] = useState(Infinity);
  const [messages, setMessages] = useState([
    {
      sender: "bot",
      text:
        "Hi, I'm your Legal Interview Assistant. Try asking me to analyze the case to begin!",
    },
  ]);
  const [userInput, setUserInput] = useState("");
  const [isAItyping, setIsAItyping] = useState(false);
  const [utterance, setUtterance] = useState(null);
  const [isSpeaking, setIsSpeaking] = useState(false); // Track if TTS is speaking
  const [copied, setCopied] = useState(false);




  // Ref for scrolling to bottom of message container
  const messagesEndRef = useRef(null);

  // Smooth scroll when messages change or when the AI starts typing
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isAItyping]);

  useEffect(() => {
    const fetchMessageLimit = async () => {
      const session = await fetchAuthSession();
      const token = session.tokens.idToken;
      const user_id = session.tokens.idToken.payload.sub;
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ENDPOINT}student/message_limit?user_id=${user_id}`,
          {
            method: "GET",
            headers: {
              Authorization: token,
              "Content-Type": "application/json",
            },
          }
        );
        if (!response.ok) throw new Error("Message limit not found");
        const data = await response.json();
        setMessageLimit(data.value);
      } catch (error) {
        console.error("Error fetching message limit:", error);
      }
    }

    fetchMessageLimit()
  }, [])

  useEffect(() => {
    const fetchCaseData = async () => {
      try {
        const session = await fetchAuthSession();
        const token = session.tokens.idToken;
        const cognito_id = session.tokens.idToken.payload.sub;
        const response = await fetch(
          `${import.meta.env.VITE_API_ENDPOINT}student/case_page?case_id=${caseId}&cognito_id=${cognito_id}`,
          {
            method: "GET",
            headers: {
              Authorization: token,
              "Content-Type": "application/json",
            },
          }
        );

        if (!response.ok) throw new Error("Case not found");
        const data = await response.json();
        setCaseData(data.caseData);

        const userRole =
          session.tokens.idToken.payload["cognito:groups"]?.[0] || "student";
        setUserRole(userRole);
      } catch (error) {
        console.error("Error fetching case data:", error);
        setCaseData(null);
      } finally {
        setLoading(false);
      }
    };

    const fetchMessages = async () => {
      setLoading(true);
      const session = await fetchAuthSession();
      const token = session.tokens.idToken;

      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ENDPOINT}student/get_messages?case_id=${caseId}`,
          {
            method: "GET",
            headers: {
              Authorization: token,
              "Content-Type": "application/json",
            },
          }
        );

        if (!response.ok) throw new Error("Messages not found");

        const data = await response.json();

        // Transform fetched data and clean user messages
        const formattedMessages = data.map((msg) => ({
          sender: msg.type === "ai" ? "bot" : "user",
          text:
            msg.type === "human"
              ? msg.content.replace(/^\s*user\s*/, "").trim() // Remove unwanted prefix
              : msg.content.trim(),
        }));

        // Remove the first message if it's from a user
        const filteredMessages =
          formattedMessages[0]?.sender === "user"
            ? formattedMessages.slice(1)
            : formattedMessages;

        setMessages(filteredMessages);
      } catch (error) {
        console.error("Error fetching messages data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchCaseData();
    fetchMessages();
  }, [caseId]);

  useEffect(() => {
    const fetchMessageCounter = async () => {
      const session = await fetchAuthSession();
      const token = session.tokens.idToken;
      const user_id = session.tokens.idToken.payload.sub;
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ENDPOINT}student/message_counter?user_id=${user_id}`,
          {
            method: "GET",
            headers: {
              Authorization: token,
              "Content-Type": "application/json",
            },
          }
        );

        if (!response.ok) throw new Error("Message counter not found");

        const data = await response.json();
        setMessageCounter(data.activity_counter);
      } catch (error) {
        console.error("Error fetching message counter:", error);
      }
    }
    fetchMessageCounter();
  }, []);

  // Function to start TTS
  const startTTS = (text) => {
    const newUtterance = new SpeechSynthesisUtterance(text);
    speechSynthesis.speak(newUtterance);
    setUtterance(newUtterance);
    setIsSpeaking(true); // Set speaking to true when TTS starts
  };

  // Function to stop TTS
  const stopTTS = () => {
    if (utterance) {
      speechSynthesis.cancel(); // Stop the speech
      setIsSpeaking(false); // Set speaking to false when TTS stops
    }
  };

  const handleCopyClick = (message) => {
    if (!copied) {
      navigator.clipboard.writeText(message.text);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    }
  };

  const handleBack = () => {
    navigate("/"); // Navigate to the homepage
  };

  const handleSendMessage = async () => {
    // Block sending if AI hasn't responded
    if (isAItyping) return;

    if (userInput.trim()) {
      setMessages((prevMessages) => [
        ...prevMessages,
        { sender: "user", text: userInput },
      ]);
      setUserInput(""); // Reset input field

      // Await the AI response before updating the messages
      setIsAItyping(true);
      const llmResponse = await getAIResponse(userInput);

      setMessages((prevMessages) => [
        ...prevMessages,
        { sender: "bot", text: llmResponse },
      ]);
    }
  };

  const handleKeyPress = (event) => {
    if (event.key === "Enter" && !event.shiftKey && !isAItyping && messageCounter < messageLimit) {
      event.preventDefault();
      handleSendMessage();
    } if (messageCounter >= messageLimit && event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      setSnackbar({
        open: true,
        message: "You have reached the maximum number of messages for today. Please try again tomorrow.",
        severity: "error",
      });
    }
  };

  const handleAudioUpload = (event) => {
    const file = event.target.files[0];
    if (file) {
      console.log("Uploaded audio file:", file);
    }
  };

  const handleSnackbarClose = () => {
    setSnackbar((prev) => ({ ...prev, open: false }));
  };

  const handleGenerateSummary = async () => {
    try {
      const session = await fetchAuthSession();
      const token = session.tokens.idToken;

      setSnackbar({
        open: true, 
        message: "Case summary being generated, please check the summary tab in a few moments.",
        severity: "warning",
      });

      const response = await fetch(
        `${import.meta.env.VITE_API_ENDPOINT}student/summary_generation?case_id=${caseId}`,
        {
          method: "POST",
          headers: {
            Authorization: `${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      setSnackbar({
        open: true, 
        message: "Summary generated successfully!",
        severity: "success",
      });

      if (!response.ok) throw new Error("Failed to submit feedback");
    } catch (error) {
      console.error("Error generating summaries:", error);
    }
  };

  async function getAIResponse(userInput) {
    const session = await fetchAuthSession();
    const token = session.tokens.idToken;
    const user_id = session.tokens.idToken.payload.sub;

    async function getFetchBody() {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_ENDPOINT}student/text_generation?case_id=${caseId}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: token,
            },
            body: JSON.stringify({
              message_content: userInput,
            }),
          }
        );

        const data = await response.json();

        // Check if guardrails were triggered
        if (response.status === 400 && data.error) {
          setIsAItyping(false);
          // setSnackbar({
          //   open: true,
          //   message: data.error,
          //   severity: "warning",
          // });
          return "I'm sorry, but I cannot process that request due to content guidelines. Please rephrase your question without including personal information (names, addresses, phone numbers, etc.).";
        }

        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const res = data.llm_output.llm_output;

        setMessageCounter((prevCounter) => prevCounter + 1); // Increment message counter on frontend
        const counter_response = await fetch(
          `${import.meta.env.VITE_API_ENDPOINT}student/message_counter?user_id=${user_id}`,
          {
            method: "PUT",
            headers: {
              Authorization: token,
              "Content-Type": "application/json",
            },
          }
        );

        if (!counter_response.ok) throw new Error("Message counter not found");
        setIsAItyping(false);
        return res;
      } catch (error) {
        console.error("Error:", error);
        setIsAItyping(false);
        return "I'm sorry, there was an error processing your request.";
      }
    }

    const body = await getFetchBody();
    return body;
  }

  // Identify the index of the most recent bot message.
  const lastBotIndex = messages.reduce(
    (lastIndex, message, index) =>
      message.sender === "bot" ? index : lastIndex,
    -1
  );

  return (
    <>
    {loading && (
      <Box
        sx={{
          position: "fixed",
          top: 0,
          left: 0,
          width: "100vw",
          height: "100vh",
          backgroundColor: "rgba(255, 255, 255, 0.85)",
          zIndex: 2000,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          fontFamily: "Outfit",
        }}
      >
        <CircularProgress sx={{ color: "var(--primary)" }} />
      </Box>
    )}
    
    {!loading && 
      (caseData ? (
    <Box
      sx={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 2,
        backgroundColor: "transparent",
        color: "var(--text)",
        marginTop: "75px",
        minHeight: "100vh",
      }}
    >
      {/* Everything below this runs normally after loading */}
      <Box position="fixed" top={0} left={0} width="100%" zIndex={1000} bgcolor="white">
        {userRole === "instructor" ? <InstructorHeader /> : <StudentHeader />}
      </Box>
  
      <Box sx={{ display: "flex" }}>
        <SideMenu />

        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            padding: 2,
            width: "100%",
          }}
        >
          <Box>
            <Typography
              variant="h6"
              sx={{ fontWeight: 600, marginBottom: 2, textAlign: "left" }}
            >
              {caseData?.case_title || "Case Title Not Available"}
            </Typography>
            <Typography
              variant="body2"
              sx={{
                marginBottom: 2,
                textAlign: "left",
                border: "1px solid var(--border)",
                padding: 2,
                borderRadius: 1,
              }}
            >
              <strong>Case Overview:</strong>{" "}
              {caseData?.case_description ||
                "Overview information not available."}
            </Typography>
            <Divider sx={{ borderColor: "var(--text)" }} />
          </Box>

          {loading ? (
            <></>
          ) : (
            <Box sx={{ overflowY: "auto", marginBottom: 2 }}>
              {messages.map((message, index) => {
                if (message.sender === "bot" && index === lastBotIndex) {
                  return (
                    <Box
                      key={index}
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-start",
                        marginTop: 3,
                        marginBottom: 10,
                      }}
                    >
                      <Paper
                        sx={{
                          maxWidth: "60%",
                          padding: "0 1em",
                          backgroundColor: "var(--bot-text)",
                          borderRadius: 10,
                          borderBottomLeftRadius:
                            message.sender === "bot" ? 7 : '10',
                          borderBottomRightRadius:
                            message.sender === "bot" ? '10' : 7,
                          py: 1,
                          px: 3,
                          boxShadow: "none",
                          color: "var(--text)",
                          fontFamily: "'Roboto', sans-serif",
                        }}
                      >
                        <Typography variant="body1" sx={{ textAlign: "left" }}>
                          <div className="markdown">
                            <ReactMarkdown>{message.text}</ReactMarkdown>
                          </div>
                        </Typography>
                      </Paper>
                      <Box
                        sx={{
                          display: "flex",
                          justifyContent: "flex-end",
                          gap: 0,
                          mt: 0,
                        }}
                      >
                        <Button
                          size="small"
                          disableRipple
                          onClick={() => handleCopyClick(message)}
                          sx={{
                            minWidth: 30,
                            width: 30,
                            height: 30,
                            p: 0,
                            ml: 1,
                            color: "#808080",
                            backgroundColor: "transparent",
                            border: "none",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            outline: "none",
                            "&:focus": {
                              outline: "none",
                              boxShadow: "none",
                            },
                            "&:hover": {
                              backgroundColor: "transparent",
                              color: "var(--text)",
                            },
                          }}
                        >
                          <MessageCopyButton text={message.text} />
                        </Button>

                        <Button
                          size="extrasmall"
                          disableRipple
                          onClick={() =>
                            isSpeaking
                              ? stopTTS()
                              : startTTS(message.text)
                          }
                          sx={{
                            minWidth: 30,
                            width: 30,
                            height: 30,
                            p: 0,
                            color: "#808080",
                            backgroundColor: "transparent",
                            border: "none",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            outline: "none",
                            "&:focus": {
                              outline: "none",
                              boxShadow: "none",
                            },
                            "&:hover": {
                              backgroundColor: "transparent",
                              color: "var(--text)",
                            },
                          }}
                        >
                          {isSpeaking ? (
                            <StopRounded fontSize="small" />
                          ) : (
                            <VolumeUpRounded fontSize="small" />
                          )}
                        </Button>

                        {messages.length >= 1 && (
                          <Button
                            size="small"
                            disableRipple
                            variant="outlined"
                            sx={{
                              fontSize: "0.7rem",
                              px: 1.2,
                              py: 0.5,
                              ml: 1,
                              backgroundColor: "transparent",
                              color: "#808080",
                              borderColor: "var(--border)",
                              whiteSpace: "nowrap",
                              height: 30,
                              outline: "none",
                              "&:focus": {
                                outline: "none",
                                boxShadow: "none",
                              },
                              "&:hover": {
                                color: "var(--feedback)",
                              },
                            }}
                            onClick={() => handleGenerateSummary()}
                          >
                            Generate Summary
                          </Button>
                        )}
                      </Box>
                    </Box>
                  );
                } else {
                  return (
                    <div key={index}>
                      <Box
                        sx={{
                          display: "flex",
                          flexDirection:
                            message.sender === "bot"
                              ? "row"
                              : "row-reverse",
                          mt: 3,
                          mb: 0,
                          fontFamily: "'Inter', sans-serif",
                        }}
                      >
                        <Paper
                          sx={{
                            maxWidth: "60%",
                            padding: "0 1em",
                            backgroundColor:
                              message.sender === "bot"
                                ? "var(--bot-text)"
                                : "var(--sender-text)",
                            borderRadius: 10,
                            borderBottomLeftRadius:
                              message.sender === "bot" ? 7 : '10',
                            borderBottomRightRadius:
                              message.sender === "bot" ? '10' : 7,
                            px: 3,
                            boxShadow: "none",
                            // border: message.sender === "bot" ? 'none' : '1px solid #e0e0e0',
                            ml: message.sender === "bot" ? 0 : "auto",
                            mr: message.sender === "bot" ? "auto" : 0,
                            color: "var(--text)",
                            fontFamily: "'Inter', sans-serif",
                          }}
                        >
                          <Typography variant="body1" sx={{ textAlign: "left" }}>
                            <div className="markdown">
                              <ReactMarkdown>{message.text}</ReactMarkdown>
                            </div>
                          </Typography>
                        </Paper>
                      </Box>
                      <Box
                        sx={{
                          display: "flex",
                          gap: 0,
                          mt: 0,
                          position: "absolute",
                          right: message.sender !== "bot" ? 30 : "auto",
                          left: message.sender === "bot" ? 280 : "auto",
                          opacity: 0,
                          transition: "opacity 0.3s ease-in-out",
                          "&:hover": {
                            opacity: 1,
                          },
                        }}
                      >
                        <Button
                          size="small"
                          disableRipple
                          onClick={() => handleCopyClick(message)}
                          sx={{
                            minWidth: 30,
                            width: 30,
                            height: 30,
                            p: 0,
                            color: "#808080",
                            backgroundColor: "transparent",
                            border: "none",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            outline: "none",
                            "&:focus": {
                              outline: "none",
                              boxShadow: "none",
                            },
                            "&:hover": {
                              backgroundColor: "transparent",
                              color: "var(--text)",
                            },
                          }}
                        >
                          <MessageCopyButton text={message.text} />
                        </Button>

                        <Button
                          size="extrasmall"
                          disableRipple
                          onClick={() =>
                            isSpeaking
                              ? stopTTS()
                              : startTTS(message.text)
                          }
                          sx={{
                            minWidth: 30,
                            width: 30,
                            height: 30,
                            p: 0,
                            color: "#808080",
                            backgroundColor: "transparent",
                            border: "none",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            outline: "none",
                            "&:focus": {
                              outline: "none",
                              boxShadow: "none",
                            },
                            "&:hover": {
                              backgroundColor: "transparent",
                              color: "var(--text)",
                            },
                          }}
                        >
                          {isSpeaking ? (
                            <StopRounded fontSize="small" />
                          ) : (
                            <VolumeUpRounded fontSize="small" />
                          )}
                        </Button>
                      </Box>
                    </div>
                  );
                }
              })}
              {/* Dummy element to scroll into view */}
              <div ref={messagesEndRef} />
            </Box>
          )}

          {isAItyping && (
            <Box
              sx={{
                display: "flex",
                justifyContent: "flex-start",
                mb: 6,
                mt: 0,
              }}
            >
              <TypingIndicator />
            </Box>
          )}

          <Box
            sx={{
              position: "fixed",
              bottom: 0,
              left: 0,
              width: "100%",
              display: "flex",
              justifyContent: "center",
              backgroundColor: "var(--background)",
              boxShadow: "none",
              padding: 2,
            }}
          >
            <Box
              sx={{
                position: "fixed",
                bottom: 0,
                right: 0,
                minHeight: "95px",
                width: "calc(100% - 250px)",
                minWidth: "70vw",
                display: "flex",
                justifyContent: "center",
                backgroundColor: "var(--background)",
                boxShadow: "none",
                background: "none",
              }}
            >
              <Box
                sx={{
                  width: "100%",
                  maxWidth: "90vw",
                  maxHeight: "650px",
                  display: "flex",
                  alignItems: "center",
                  backgroundColor: "var(--background)",
                  borderRadius: 10,
                  paddingBottom: "1.25em",
                  boxShadow: "none",
                }}
              >
                <TextField
  placeholder={
    caseData?.status === "Archived"
      ? "This case is archived. Unarchive to continue using the assistant."
      : "Type here..."
  }
  variant="outlined"
  fullWidth
  multiline
  value={userInput}
  onChange={(e) => setUserInput(e.target.value)}
  onKeyDown={handleKeyPress}
  disabled={caseData?.status === "Archived"}
  inputProps={{maxLength : 2000}}
helperText={
    <span style={{ color: userInput.length >= 2000 ? 'red' : 'inherit' }}>
      {userInput.length}/2000
    </span>
  }  sx={{
    maxHeight: "300px",
    overflowY: "auto",
    mr: "0.5em",
    ml: "1em",
    backgroundColor: caseData?.status === "Archived" ? "var(--background)" : "var(--background)",
    "& .MuiOutlinedInput-notchedOutline": {
      borderColor: "var(--border)",
      borderRadius: 10,
    },
    "&:hover .MuiOutlinedInput-notchedOutline": {
      borderColor: "var(--border)",
    },
  }}
  InputProps={{
    style: {
      backgroundColor: "transparent",
      color: "var(--text)",
    },
  }}
/>

<Button
  variant="contained"
  sx={{
    color: "#ffffff",
    backgroundColor: "var(--secondary)",
    minHeight: "55px",
    borderRadius: 10,
    minWidth: "55px",
    mr: "2em",
    fontFamily: "Inter",
    "&:hover": {
      backgroundColor: "var(--primary)",
    },
  }}
  onClick={handleSendMessage}
  disabled={isAItyping || (messageCounter >= messageLimit) || caseData?.status === "Archived"}
>
  <ArrowUpwardRoundedIcon sx={{ color: "white" }} />
</Button>
                <p style={{position: "fixed", bottom: 2, left: 65, right: 0, width: '100%', fontFamily: 'Outfit', fontSize: '0.9rem', color: "var(--placeholder-text)"}}>AI can make mistakes. Please check important information and citations.</p>
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>
      {/* Snackbar for alerts */}
            <Snackbar
              open={snackbar.open}
              autoHideDuration={4000}
              onClose={handleSnackbarClose}
              anchorOrigin={{ vertical: "top", horizontal: "center" }}
            >
              <Alert onClose={handleSnackbarClose} severity={snackbar.severity} variant='standard' sx={{ width: "100%" }}>
                {snackbar.message}
              </Alert>
            </Snackbar>
    </Box>)
    :
    (<NotFound/>)
          )};
    </>
  );
};

export default InterviewAssistant;
