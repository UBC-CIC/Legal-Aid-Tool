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

  // Password validation state
  const [passwordRequirements, setPasswordRequirements] = useState({
    minLength: false,
    hasLowercase: false,
    hasUppercase: false,
    hasNumber: false,
    hasSpecialChar: false,
    passwordsMatch: false,
  });

  // Check password requirements
  const checkPasswordRequirements = (password, confirmPwd = confirmPassword) => {
    setPasswordRequirements({
      minLength: password.length >= 12,
      hasLowercase: /[a-z]/.test(password),
      hasUppercase: /[A-Z]/.test(password),
      hasNumber: /\d/.test(password),
      hasSpecialChar: /[!@#$%^&*(),.?":{}|<>]/.test(password),
      passwordsMatch: password === confirmPwd && password !== '',
    });
  };

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
    '& .MuiInputLabel-asterisk': {
    color: '#f44336',
  },
  };

  const iconProps = {
    sx: { color: 'var(--placeholder-text)', fontSize: 20 },
  };

  return (
    <div container sx={{ height: "100vh", backgroundColor: "var(--background2)", transition: "background-color 0.3s ease" }}>
      <ToastContainer />



      <Grid item xs={12} sm={6} sx={{ display: "flex", justifyContent: "center", alignItems: "center", p: 2, transition: "all 0.3s ease", opacity: 0, animation: 'fadeIn 0.6s forwards', minHeight: '100vh',  backgroundColor: 'var(--background2)' }}>
        <Box sx={{ width: "100%", maxWidth: 420, animation: 'slideUp 0.6s ease-out', border: "1px solid var(--border)", borderRadius: 2, padding: 2, backgroundColor: "var(--background)" }}>
          <Typography variant="h5" fontWeight={600} textAlign="left" mb={2} sx={{ color: "var(--text)", fontFamily: "Outfit", fontSize: 22, transition: "all 0.3s ease", }}>
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
                      <Box sx={{ display: 'flex', gap: 2 }}>
                        <TextField 
                          label="First Name" 
                          variant="outlined" 
                          margin="normal"
                          required 
                          value={firstName} 
                          onChange={(e) => setFirstName(e.target.value)} 
                          sx={{ ...inputStyles, flex: 1 }} 
                        />
                        <TextField 
                          label="Last Name" 
                          variant="outlined" 
                          margin="normal" 
                          required
                          value={lastName} 
                          onChange={(e) => setLastName(e.target.value)} 
                          sx={{ ...inputStyles, flex: 1 }} 
                        />
                      </Box>
                    )}
                    <TextField
                      fullWidth
                      label="Email"
                      placeholder="example@ubc.ca"
                      type="email"
                      variant="outlined"
                      margin="normal"
                      required
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
                      required
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (isSignUp) checkPasswordRequirements(e.target.value);
                      }}
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
                    {isSignUp && password && (
                      <Box sx={{ 
                        mt: 0.5, 
                        mb: 0.5, 
                        p: 0.8, 
                        backgroundColor: 'var(--background2)', 
                        borderRadius: 1, 
                        border: '1px solid var(--border)'
                      }}>
                        <Typography variant="caption" sx={{ 
                          color: 'var(--text)', 
                          fontWeight: 600, 
                          mb: 0.3, 
                          display: 'block',
                          fontFamily: 'Outfit',
                          fontSize: '0.65rem'
                        }}>
                          Requirements:
                        </Typography>
                        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box sx={{ 
                              width: 12, 
                              height: 12, 
                              borderRadius: '50%', 
                              backgroundColor: passwordRequirements.minLength ? '#4caf50' : 'var(--border)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}>
                              {passwordRequirements.minLength && <Typography sx={{ color: 'white', fontSize: 8 }}>✓</Typography>}
                            </Box>
                            <Typography variant="caption" sx={{ 
                              color: passwordRequirements.minLength ? '#4caf50' : 'var(--placeholder-text)',
                              fontFamily: 'Outfit',
                              fontSize: '0.65rem'
                            }}>
                              At least 12 characters
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box sx={{ 
                              width: 12, 
                              height: 12, 
                              borderRadius: '50%', 
                              backgroundColor: passwordRequirements.hasLowercase ? '#4caf50' : 'var(--border)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}>
                              {passwordRequirements.hasLowercase && <Typography sx={{ color: 'white', fontSize: 8 }}>✓</Typography>}
                            </Box>
                            <Typography variant="caption" sx={{ 
                              color: passwordRequirements.hasLowercase ? '#4caf50' : 'var(--placeholder-text)',
                              fontFamily: 'Outfit',
                              fontSize: '0.65rem'
                            }}>
                              One lowercase letter
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box sx={{ 
                              width: 12, 
                              height: 12, 
                              borderRadius: '50%', 
                              backgroundColor: passwordRequirements.hasUppercase ? '#4caf50' : 'var(--border)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}>
                              {passwordRequirements.hasUppercase && <Typography sx={{ color: 'white', fontSize: 8 }}>✓</Typography>}
                            </Box>
                            <Typography variant="caption" sx={{ 
                              color: passwordRequirements.hasUppercase ? '#4caf50' : 'var(--placeholder-text)',
                              fontFamily: 'Outfit',
                              fontSize: '0.65rem'
                            }}>
                              One uppercase letter
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                            <Box sx={{ 
                              width: 12, 
                              height: 12, 
                              borderRadius: '50%', 
                              backgroundColor: passwordRequirements.hasNumber ? '#4caf50' : 'var(--border)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}>
                              {passwordRequirements.hasNumber && <Typography sx={{ color: 'white', fontSize: 8 }}>✓</Typography>}
                            </Box>
                            <Typography variant="caption" sx={{ 
                              color: passwordRequirements.hasNumber ? '#4caf50' : 'var(--placeholder-text)',
                              fontFamily: 'Outfit',
                              fontSize: '0.65rem'
                            }}>
                              One number
                            </Typography>
                          </Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, gridColumn: 'span 2' }}>
                            <Box sx={{ 
                              width: 12, 
                              height: 12, 
                              borderRadius: '50%', 
                              backgroundColor: passwordRequirements.hasSpecialChar ? '#4caf50' : 'var(--border)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}>
                              {passwordRequirements.hasSpecialChar && <Typography sx={{ color: 'white', fontSize: 8 }}>✓</Typography>}
                            </Box>
                            <Typography variant="caption" sx={{ 
                              color: passwordRequirements.hasSpecialChar ? '#4caf50' : 'var(--placeholder-text)',
                              fontFamily: 'Outfit',
                              fontSize: '0.65rem'
                            }}>
                              One special character
                            </Typography>
                          </Box>
                        </Box>
                      </Box>
                    )}
                    {isSignUp && (
                      <TextField
                        fullWidth
                        label="Confirm Password"
                        type={showConfirmPassword ? "text" : "password"}
                        variant="outlined"
                        margin="normal"
                        autoComplete="new-password"
                        value={confirmPassword}
                        onChange={(e) => {
                          setConfirmPassword(e.target.value);
                          if (password) checkPasswordRequirements(password, e.target.value);
                        }}
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
                    {isSignUp && confirmPassword && (
                      <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <Box sx={{ 
                          width: 16, 
                          height: 16, 
                          borderRadius: '50%', 
                          backgroundColor: passwordRequirements.passwordsMatch ? '#4caf50' : '#f44336',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}>
                          {passwordRequirements.passwordsMatch ? 
                            <Typography sx={{ color: 'white', fontSize: 10 }}>✓</Typography> :
                            <Typography sx={{ color: 'white', fontSize: 10 }}>✗</Typography>
                          }
                        </Box>
                        <Typography variant="caption" sx={{ 
                          color: passwordRequirements.passwordsMatch ? '#4caf50' : '#f44336',
                          fontFamily: 'Outfit'
                        }}>
                          {passwordRequirements.passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
                        </Typography>
                      </Box>
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
