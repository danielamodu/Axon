import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { Login, Signup } from "./pages/Auth";
import Home from "./pages/Home";
import { Dashboard, Docs, ExecutionDetail, NotFoundPage, Privacy, ProtocolDetail, Register, Settings, Terms } from "./pages/ProductPages";


function Router() {
  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/login"} component={Login} />
      <Route path={"/signup"} component={Signup} />
      <Route path={"/dashboard"} component={Dashboard} />
      <Route path={"/app"} component={Dashboard} />
      <Route path={"/protocol/:id"} component={ProtocolDetail} />
      <Route path={"/register"} component={Register} />
      <Route path={"/execution/:txHash"} component={ExecutionDetail} />
      <Route path={"/docs"} component={Docs} />
      <Route path={"/settings"} component={Settings} />
      <Route path={"/privacy"} component={Privacy} />
      <Route path={"/terms"} component={Terms} />
      <Route path={"/404"} component={NotFoundPage} />
      {/* Final fallback route */}
      <Route component={NotFoundPage} />
    </Switch>
  );
}

// NOTE: About Theme
// - First choose a default theme according to your design style (dark or light bg), than change color palette in index.css
//   to keep consistent foreground/background color across components
// - If you want to make theme switchable, pass `switchable` ThemeProvider and use `useTheme` hook

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider
        defaultTheme="light"
        // switchable
      >
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
