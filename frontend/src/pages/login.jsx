import { useEffect, useState } from "react";
import {
  TextField,
  Button,
  Typography,
  Box,
  CircularProgress,
  Link,
  Grid,
  IconButton,
  InputAdornment,
} from "@mui/material";
import { Visibility, VisibilityOff, Email, Lock } from "@mui/icons-material";
import {
  signIn,
  signUp,
  fetchAuthSession,
  resetPassword,
  confirmResetPassword,
  confirmSignUp,
} from "aws-amplify/auth";
import { toast, ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

const Login = () => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [isReset, setIsReset] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmationCode, setConfirmationCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [step, setStep] = useState("requestReset");
  const [isConfirmingSignUp, setIsConfirmingSignUp] = useState(false); 
  const [logo, setLogo] = useState("logo_dark.svg");

  const updateLogoBasedOnTheme = () => {
    const isDarkMode = window.matchMedia("(prefers-color-scheme: dark)").matches;
    setLogo(isDarkMode ? "/logo_dark.svg" : "/logo_light.svg");
  };

  useEffect(() => {
    updateLogoBasedOnTheme();

    const themeChangeListener = (e) => {
      updateLogoBasedOnTheme();
    };
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", themeChangeListener);

    return () => {
      window.matchMedia("(prefers-color-scheme: dark)").removeEventListener("change", themeChangeListener);
    };
  }, []);


  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isSignUp) {
        if (password !== confirmPassword) {
          toast.error("Passwords do not match");
          setLoading(false);
          return;
        }
        await signUp({
          username: email,
          password,
          attributes: {
            email,
            given_name: firstName,
            family_name: lastName,
          },
        });
        toast.success("Sign up successful. Check your email to confirm.");
        setIsConfirmingSignUp(true); // Set the step to confirmation after sign-up
      } else {
        const user = await signIn({ username: email, password });
        if (user.isSignedIn) {
          const session = await fetchAuthSession();
          const token = session.tokens.idToken;
          const response = await fetch(`${import.meta.env.VITE_API_ENDPOINT}student/create_user?user_email=${encodeURIComponent(email)}&username=${encodeURIComponent(email)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}`, {
            method: "POST",
            headers: {
              Authorization: token,
              "Content-Type": "application/json",
            },
          });
          const data = await response.json();
          window.location.reload();
        }
      }
    } catch (err) {
      toast.error(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmSignUp = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await confirmSignUp({
        username: email,
        confirmationCode,
      });
      toast.success("Account confirmed successfully.");
      setIsConfirmingSignUp(false); // After confirmation, switch back to sign-in
      // Auto login after confirmation
      const user = await signIn({ username: email, password });
      if (user.isSignedIn) {
        const session = await fetchAuthSession();
        const token = session.tokens.idToken;
        // Fetch user data after auto-login
        const response = await fetch(`${import.meta.env.VITE_API_ENDPOINT}/student/create_user?user_email=${encodeURIComponent(email)}&username=${encodeURIComponent(email)}&first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}`, {
          method: "POST",
          headers: {
            Authorization: token,
            "Content-Type": "application/json",
          },
        });
        const data = await response.json();
        window.location.reload();
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    try {
      const output = await resetPassword({ username: email });
      const step = output.nextStep.resetPasswordStep;
      if (step === "CONFIRM_RESET_PASSWORD_WITH_CODE") {
        toast.success("Check your email for the confirmation code.");
        setStep("confirmReset");
      } else if (step === "DONE") {
        toast.success("Password reset already completed.");
        setIsReset(false);
        setStep("requestReset");
      }
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleConfirmReset = async (e) => {
    e.preventDefault();
    try {
      await confirmResetPassword({ username: email, confirmationCode, newPassword });
      toast.success("Password reset successfully.");
      setIsReset(false);
      setStep("requestReset");
      setEmail("");
      setConfirmationCode("");
      setNewPassword("");
    } catch (err) {
      toast.error(err.message);
    }
  };

  const inputStyles = {
    transition: 'all 0.3s ease',
    input: {
      WebkitBoxShadow: '0 0 0 1000px var(--background) inset',
      WebkitTextFillColor: 'var(--text)',
    },
    '& .MuiOutlinedInput-notchedOutline': {
      borderColor: 'var(--border)',
    },
    '&:hover .MuiOutlinedInput-notchedOutline': {
      borderColor: 'var(--border)',
    },
    '& .MuiInputBase-root': {
      backgroundColor: 'var(--background)',
      color: 'var(--text)',
    },
    '& .MuiInputLabel-root': {
      color: 'var(--text)',
    },
  };

  const iconProps = {
    sx: { color: 'var(--placeholder-text)', fontSize: 20 },
  };

  return (
    <div container sx={{ height: "100vh", backgroundColor: "var(--background2)", transition: "background-color 0.3s ease" }}>
      <ToastContainer />

      {/* <Grid
        item
        xs={false}
        sm={6}
        sx={{
          background: "linear-gradient(to bottom right, 'var(--background)', 'var(--secondary)')",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          color: "white",
          p: 4,
          transition: "all 0.3s ease",
        }}
      >
        <div style={{ opacity: 0, animation: 'fadeIn 0.6s forwards', display: 'flex', alignItems: 'center', gap: '16px'}}>
          <img src="logo_dark.svg" alt="Logo" style={{ width: "100px", height: "100px" }} />
          <Typography variant="h3" fontWeight={600} fontFamily="Outfit">
            Legal Aid Tool
          </Typography>
        </div>
      </Grid> */}

      <Grid item xs={12} sm={6} sx={{ display: "flex", justifyContent: "center", alignItems: "center", p: 4, transition: "all 0.3s ease", opacity: 0, animation: 'fadeIn 0.6s forwards', height: '100vh',  backgroundColor: 'var(--background2)' }}>
        <Box sx={{ width: "100%", maxWidth: 500, animation: 'slideUp 0.6s ease-out', border: "1px solid var(--border)", borderRadius: 2, padding: 4, backgroundColor: "var(--background)" }}>
          <Typography variant="h5" fontWeight={600} textAlign="left" mb={3} sx={{ color: "var(--text)", fontFamily: "Outfit", fontSize: 26, transition: "all 0.3s ease", }}>
          <div style={{ opacity: 0, animation: 'fadeIn 0.6s forwards', display: 'flex', alignItems: 'center', gap: '8px'}}>
          <img src={logo} alt="Logo" style={{ width: "50px", height: "50px" }} />
            {isReset ? "Reset Password" : isSignUp ? "Create Account" : "Legal Aid Tool"}
            </div>
          </Typography>

          {/* Conditional rendering of forms based on state */}
          <Box component="form" onSubmit={isReset && step === "confirmReset" ? handleConfirmReset : isConfirmingSignUp ? handleConfirmSignUp : handleSubmit}>
            {isConfirmingSignUp ? (
              <>
                <TextField fullWidth label="Confirmation Code" margin="normal" value={confirmationCode} onChange={(e) => setConfirmationCode(e.target.value)} sx={inputStyles} />
                <Button type="submit" fullWidth variant="contained" sx={{ mt: 2, color: "white", backgroundColor: "var(--primary)", boxShadow: 'none', borderRadius: 2, fontFamily: 'Outfit', "&:hover": {backgroundColor: "var(--secondary)", boxShadow: "none",} }}>
                {loading ? <CircularProgress size={24} color="inherit" /> : "Confirm Sign Up" }
                </Button>
                <Box mt={2} textAlign="center">
                  <Link href="#" onClick={(e) => { e.preventDefault(); setIsConfirmingSignUp(false); }} underline="hover" sx={{ fontSize: 14, color: "var(--primary)" }}>Back to Sign In</Link>
                </Box>
              </>
            ) : (
              <>
                {isReset ? (
                  <>
                    <TextField
                      fullWidth
                      label="Email"
                      placeholder="example@ubc.ca"
                      type="email"
                      variant="outlined"
                      margin="normal"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)} 
                      InputProps={{ startAdornment: <InputAdornment position="start"><Email {...iconProps} /></InputAdornment> }}
                      sx={inputStyles}
                    />
                    {step === "confirmReset" && (
                      <>
                        <TextField fullWidth label="Confirmation Code" margin="normal" value={confirmationCode} onChange={(e) => setConfirmationCode(e.target.value)} sx={inputStyles} />
                        <TextField fullWidth label="New Password" type="password" margin="normal" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} sx={inputStyles} />
                      </>
                    )}
                    {step === "requestReset" && <Button fullWidth onClick={handleReset} variant="contained" sx={{ mt: 2, color: "white", backgroundColor: "var(--primary)", boxShadow: 'none', borderRadius: 2, fontFamily: 'Outfit', "&:hover": {backgroundColor: "var(--secondary)", boxShadow: "none",} }}>Send Reset Code</Button>}
                    {step === "confirmReset" && <Button type="submit" fullWidth variant="contained" sx={{ mt: 2, color: "white", backgroundColor: "var(--primary)", boxShadow: 'none', borderRadius: 2, fontFamily: 'Outfit', "&:hover": {backgroundColor: "var(--secondary)", boxShadow: "none",} }}>Confirm Reset</Button>}
                    <Box mt={2} textAlign="center">
                      <Link href="#" onClick={(e) => { e.preventDefault(); setIsReset(false); }} underline="hover" sx={{ fontSize: 14, color: "var(--primary)" }}>Back to Sign In</Link>
                    </Box>
                  </>
                ) : (
                  <>
                    {isSignUp && (
                      <>
                        <TextField fullWidth label="First Name" variant="outlined" margin="normal" value={firstName} onChange={(e) => setFirstName(e.target.value)} sx={inputStyles} />
                        <TextField fullWidth label="Last Name" variant="outlined" margin="normal" value={lastName} onChange={(e) => setLastName(e.target.value)} sx={inputStyles} />
                      </>
                    )}
                    <TextField
                      fullWidth
                      label="Email"
                      placeholder="example@ubc.ca"
                      type="email"
                      variant="outlined"
                      margin="normal"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      InputProps={{ startAdornment: <InputAdornment position="start"><Email {...iconProps} /></InputAdornment> }}
                      sx={inputStyles}
                    />
                    <TextField
                      fullWidth
                      label="Password"
                      type={showPassword ? "text" : "password"}
                      variant="outlined"
                      margin="normal"
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      InputProps={{
                        startAdornment: <InputAdornment position="start"><Lock {...iconProps} /></InputAdornment>,
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              onClick={() => setShowPassword(!showPassword)}
                              edge="end"
                              disableRipple
                              sx={{
                                p: 0.5,
                                border: 'none',
                                outline: 'none',
                                '&:focus': {
                                  outline: 'none',
                                  boxShadow: 'none',
                                },
                                '&:hover': {
                                  backgroundColor: 'transparent',
                                },
                              }}
                            >
                              {showPassword ? <VisibilityOff {...iconProps} /> : <Visibility {...iconProps} />}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                      sx={inputStyles}
                    />
                    {isSignUp && (
                      <TextField
                        fullWidth
                        label="Confirm Password"
                        type={showConfirmPassword ? "text" : "password"}
                        variant="outlined"
                        margin="normal"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        InputProps={{
                          startAdornment: <InputAdornment position="start"><Lock {...iconProps} /></InputAdornment>,
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton onClick={() => setShowConfirmPassword(!showConfirmPassword)} edge="end" disableRipple
                              sx={{
                                p: 0.5,
                                border: 'none',
                                outline: 'none',
                                '&:focus': {
                                  outline: 'none',
                                  boxShadow: 'none',
                                },
                                '&:hover': {
                                  backgroundColor: 'transparent',
                                },
                              }}>
                                {showConfirmPassword ? <VisibilityOff {...iconProps} /> : <Visibility {...iconProps} />}
                              </IconButton>
                            </InputAdornment>
                          ),
                        }}
                        sx={inputStyles}
                      />
                    )}
                    {!isSignUp && (
                      <Box textAlign="right" mt={1}>
                        <Link href="#" underline="hover" onClick={(e) => { e.preventDefault(); setIsReset(true); }} sx={{ fontSize: 13, color: 'var(--primary)' }}>
                          Forgot password?
                        </Link>
                      </Box>
                    )}
                    <Button type="submit" fullWidth variant="contained" sx={{ mt: 2, color: "white", backgroundColor: "darkgrey", boxShadow: 'none', borderRadius: 2, fontFamily: 'Outfit', "&:hover": {backgroundColor: "darkgrey", boxShadow: "none",} }} disabled={loading}>
                      {loading ? <CircularProgress size={24} color="inherit" /> : isSignUp ? "Sign Up" : "Sign In"}
                    </Button>
                    <Box textAlign="center" mt={2}>
                      <Link href="#" onClick={(e) => { e.preventDefault(); setIsSignUp(prev => !prev); }} underline="hover" sx={{ fontSize: 14, color: "var(--primary)" }}>
                        {isSignUp ? "Already have an account? Sign In" : "Don't have an account? Sign Up"}
                      </Link>
                    </Box>
                  </>
                )}
              </>
            )}
          </Box>
        </Box>
      </Grid>
    </div>
  );
};

export default Login;
