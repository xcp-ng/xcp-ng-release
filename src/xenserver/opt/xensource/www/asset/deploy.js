let call,
  vmRef,
  vmIp,
  host = window.location.host;

function _handleUserError(error) {
  alert(typeof error === "object" && !(error instanceof Error) ? JSON.stringify(error, null, 2) : (error && error.message) || error);
}

function setStep(previousStep, nextStep) {
  document.querySelector(`#${previousStep}`).style.display = "none";
  document.querySelector(`#${nextStep}`).style.display = "block";
}

function _jsonRpcCall(url, method, params) {
  console.log(`-> ${method}(${JSON.stringify(params)})`);
  return window
    .fetch(url, {
      body: JSON.stringify({
        id: 0,
        jsonrpc: "2.0",
        method,
        params,
      }),
      method: "POST",
      headers: new Headers({
        Accept: "application/json",
        "Content-Type": "application/json",
      }),
    })
    .then((res) => {
      if (!res.ok) {
        throw res.status;
      }
      return res.json().then((json) => {
        if (json.result !== undefined) {
          console.log(`<- ${JSON.stringify(json.result)}`);
          return json.result;
        }
        console.error(`<x ${JSON.stringify(json.error)}`);
        throw json.error;
      });
    });
}
function _call(method, params) {
  return _jsonRpcCall(`//${host}/jsonrpc`, method, params).catch((error) => {
    if (error && error.message === "HOST_IS_SLAVE") {
      console.log("Host is slave, changing host to master", error.data[0]);
      host = error.data[0];
      return _call(method, params);
    }
    throw error;
  });
}

function connect() {
  document.querySelector("#connect fieldset").setAttribute("disabled", true);
  _call("session.login_with_password", ["root", document.querySelector("#pwd").value, "2.3", "XOA deploy"])
    .then((sessionRef) => {
      call = (method, ...params) => _call(method, [sessionRef].concat(params));
    })
    .then(() => Promise.all([call("SR.get_all_records"), call("pool.get_all_records"), call("network.get_all_records"), call("PIF.get_all_records")]))
    .then(([srs, pools, networks, pifs]) => {
      setStep("connect", "config");
      const selectSr = document.querySelector("#srs");
      let sr;

      Object.keys(srs).forEach((srRef) => {
        sr = srs[srRef];
        if (sr.content_type !== "iso" && sr.physical_size > 0) {
          let option = document.createElement("option");
          option.value = srRef;
          option.textContent = `${sr.name_label} - ${Math.round((sr.physical_size - sr.physical_utilisation) / Math.pow(1024, 3))} GiB left`;
          selectSr.append(option);
        }
      });
      const { default_SR } = pools[Object.keys(pools)[0]];

      if (default_SR !== undefined) {
        selectSr.value = default_SR;
      }
      const selectNetwork = document.querySelector("#networks");
      Object.keys(networks).forEach((networkRef) => {
        let network = networks[networkRef];
        const option = document.createElement("option");
        option.value = networkRef;
        option.dataset.mtu = network.MTU;
        option.textContent = network.name_label;
        selectNetwork.append(option);
      });
      const managementPif = Object.values(pifs).find((pif) => pif.management);
      if (managementPif && managementPif.network !== undefined) {
        selectNetwork.val(managementPif.network);
      }
    })
    .catch((err) => {
      document.querySelector("#connect fieldset").removeAttribute("disabled");
      this._handleUserError(err);
    });
}

function submitConfig() {
  const ipError = document.querySelector("#ip-error");
  ipError.style.display = "none";
  const ip = document.querySelector("#ip").value;
  if (ip === window.location.hostname) {
    ipError.style.display = "block";
    return;
  }
  setStep("config", "accounts");
}

function deploy() {
  const status = (text) => (document.querySelector("#deploy").innerText = text);
  document.querySelector(".spinner").style.display = "inherit";
  const srRef = document.querySelector("#srs").value;
  status("Deploying XOA…");
  document.querySelector("#accounts fieldset").setAttribute("disabled", true);
  let registrationToken;
  const updaterEmail = document.querySelector("#updaterEmail").value;
  const updaterPwd = document.querySelector("#updaterPwd").value;
  Promise.resolve()
    .then(() => {
      if (updaterEmail && updaterPwd) {
        return _jsonRpcCall("https://xen-orchestra.com/api", "registerXoa", {
          email: updaterEmail,
          password: updaterPwd,
        }).then((_registrationToken) => {
          registrationToken = _registrationToken;
        });
      }
    })
    .then(() =>
      call(
        "VM.import",
        "http://xoa.io:8888/",
        srRef,
        false, // full_restore
        false // force
      )
    )
    .then(([_vmRef]) => {
      vmRef = _vmRef;
      status("Configuring XOA…");
      const promises = [];
      const ip = document.querySelector("#ip").value;
      if (ip) {
        promises.push(
          call("VM.add_to_xenstore_data", vmRef, "vm-data/ip", ip),
          call("VM.add_to_xenstore_data", vmRef, "vm-data/netmask", document.querySelector("#netmask")?.value || "255.255.255.0"),
          call("VM.add_to_xenstore_data", vmRef, "vm-data/gateway", document.querySelector("#gateway")?.value || ""),
          call("VM.add_to_xenstore_data", vmRef, "vm-data/dns", document.querySelector("#dns").value || "8.8.8.8")
        );
      }
      const email = document.querySelector("#adminEmail").value;
      const password = document.querySelector("#adminPwd").value;
      if (email && password) {
        promises.push(call("VM.add_to_xenstore_data", vmRef, "vm-data/admin-account", JSON.stringify({ email, password })));
      }
      if (registrationToken) {
        promises.push(call("VM.add_to_xenstore_data", vmRef, "vm-data/xoa-updater-credentials", JSON.stringify({ email: updaterEmail, registrationToken })));
      }
      const xoaPwd = document.querySelector("#xoaPwd").value;
      if (xoaPwd) {
        promises.push(call("VM.add_to_xenstore_data", vmRef, "vm-data/system-account-xoa-password", xoaPwd));
      }
      promises.push(
        call(
          "VM.add_to_xenstore_data",
          vmRef,
          "vm-data/xen-servers",
          JSON.stringify([
            {
              allowUnauthorized: true,
              host,
              password: document.querySelector("#pwd").value,
              username: "root",
            },
          ])
        )
      );

      const network = document.querySelector("#networks").value;
      const MTU = document.querySelector("#networks option:checked").dataset.mtu;
      promises.push(
        call("VM.get_VIFs", vmRef)
          .then(([vifRef]) => call("VIF.destroy", vifRef))
          .then(() => call("VM.get_allowed_VIF_devices", vmRef))
          .then((devices) =>
            call("VIF.create", {
              device: devices[0],
              MAC: "",
              MTU,
              network,
              other_config: {},
              qos_algorithm_params: {},
              qos_algorithm_type: "",
              VM: vmRef,
            })
          )
      );

      return Promise.all(promises);
    })
    .then(() => {
      status("Starting XOA…");
      return call(
        "VM.start",
        vmRef,
        false, // start_paused
        false // force
      );
    })
    .then(() => call("VM.get_guest_metrics", vmRef))
    .then((metricsRef) => {
      status("Almost there…");
      let attempts = 120;
      const waitForIp = () => {
        return call("VM_guest_metrics.get_networks", metricsRef).then((networks) => {
          if (networks && networks["0/ip"] !== undefined) {
            return networks["0/ip"];
          }
          if (attempts-- === 0) {
            throw "XOA not responding";
          }
          return new Promise((resolve, reject) => setTimeout(() => waitForIp().then(resolve, reject), 1e3));
        });
      };
      return waitForIp();
    })
    .then((ip) => {
      vmIp = ip;
      return Promise.all(
        ["admin-account", "dns", "gateway", "ip", "netmask", "xen-servers", "xoa-updater-credentials"].map((key) =>
          call("VM.remove_from_xenstore_data", vmRef, `vm-data/${key}`).catch((error) => {
            console.warn("VM.remove_from_xenstore_data", key, error);
          })
        )
      );
    })
    .then(() => {
      status("XOA is ready! Redirecting…");
      setTimeout(() => {
        window.location = `https://${document.querySelector("#ip").value || vmIp}`;
      }, 3e3);
    })
    .catch((err) => {
      document.querySelector("#accounts fieldset").removeAttribute("disabled");
      document.querySelector(".spinner").style.display = "none";
      status("Deploy");
      this._handleUserError(err);
    });
}

// Replacement for jquery modal

window.addEventListener("DOMContentLoaded", () => {
  [...document.querySelectorAll("[rel='modal:open']")].forEach((modalTrigger) => {
    modalTrigger.addEventListener("click", (e) => {
      e.preventDefault();

      document.documentElement.style.overflow = "hidden";
      const modal = document.querySelector(modalTrigger.getAttribute("href"));
      const modalContainer = document.createElement("div");
      modalContainer.className = "modal-container blocker current";
      modalContainer.append(modal);
      modal.style.display = "block";
      document.body.append(modalContainer);
      // close button
      const closeButton = document.createElement("a");
      closeButton.setAttribute("href", "#close-modal");
      closeButton.setAttribute("rel", "modal:close");
      closeButton.setAttribute("class", "close-modal");
      closeButton.title = "Close modal";
      modal.append(closeButton);

      const close = (e) => {
        e.preventDefault();
        modal.style.display = "none";
        document.body.appendChild(modal);
        modalContainer.remove();
        closeButton.remove();
        document.documentElement.style.overflow = "";
      };
      [...modalContainer.querySelectorAll("[rel='modal:close']")].forEach((button) => {
        button.addEventListener("click", close);
      });
    });
  });
});
