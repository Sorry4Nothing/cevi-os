import { Redirect } from "expo-router";

// Kalter Start und das Tor landen auf «/»: weiter zum ersten Tab
export default function Index() {
  return <Redirect href="/programme" />;
}
