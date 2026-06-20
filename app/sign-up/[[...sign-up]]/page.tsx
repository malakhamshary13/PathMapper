import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div style={{ display: "flex", minHeight: "100vh", alignItems: "center", justifyContent: "center", background: "#0B0B14" }}>
      <SignUp 
        path="/sign-up" 
        routing="path" 
        signInUrl="/sign-in"
      />
    </div>
  );
}